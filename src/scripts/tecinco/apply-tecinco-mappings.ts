/**
 * apply-tecinco-mappings.ts
 *
 * Consome tecinco-certeza.json + tecinco-resolvido.json (gerados/curados nesta
 * sessão a partir de dump-tecinco-catalog.ts + dump-local-products.ts + análise
 * manual) e aplica o resultado final no banco, nessa ordem fixa:
 *
 *   1. Apaga TODOS os integration_mappings de PRODUCT da Tecinco (reset).
 *   2. Apaga os produtos marcados como duplicata (`produto_duplicado_para_excluir`
 *      em qualquer um dos dois JSONs) — só os que não têm stock_movements nem
 *      expedition_batch_items (esses dois bloqueiam; invoice_items e
 *      inventory_batch_items não importam, são apagados junto). Se tiver
 *      stock_movements/expedition_batch_items, pula e avisa em vez de forçar.
 *   3. Cria os integration_mappings novos — certeza.json inteiro +
 *      resolvido.json só nas linhas com acao="mapear_produto_existente"
 *      (criar_produto_novo e codigo_tecinco_duplicado não geram mapping aqui,
 *      ficam pra depois).
 *
 * Usa integrationMappingService.createOrUpdateIntegrationMapping — que agora
 * só cria (nunca reaponta um mapping já existente), então a fase 1 apagar tudo
 * antes é o que garante que a fase 3 realmente grava certo.
 *
 * Uso:
 *   npx ts-node src/scripts/tecinco/apply-tecinco-mappings.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import { Product, ProductConfig, Stock, SupplierMapping } from "../../modules/inventory";
import { InvoiceItems, ExpeditionBatchItems, OperationItems } from "../../modules/warehouse";
import StockMovement from "../../modules/inventory/stock/stock-movements/stock-movements.model";
import InventoryBatchItems from "../../modules/inventory/stock-inventory/inventory-batch-items/inventory-batch-items.model";
import OrderItems from "../../modules/sales/orders/order_items/order_items.model";
import KitComponent from "../../modules/inventory/kit-components/kit-component.model";
import IntegrationMapping from "../../modules/integrations/integration-mapping/integration-mapping.model";
import integrationMappingService from "../../modules/integrations/integration-mapping/integration-mapping.service";
import { getTCarIntegration } from "../../modules/handlers/tecinco/api/tecinco_api";

const OUT_DIR = path.join(__dirname, "output");

interface MappingRow {
  external_id: string;
  internal_id: string;
}

// ─── Carrega e junta os dois JSONs ──────────────────────────────────────────

function loadInputs() {
  const certeza = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "tecinco-certeza.json"), "utf-8"));
  const resolvido = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "tecinco-resolvido.json"), "utf-8"));

  const mappingsToCreate: MappingRow[] = [
    ...certeza.map((c: any) => ({ external_id: c.external_id, internal_id: c.internal_id })),
    ...resolvido
      .filter((r: any) => r.acao === "mapear_produto_existente" && r.internal_id)
      .map((r: any) => ({ external_id: r.external_id, internal_id: r.internal_id })),
  ];

  const productsToDelete = new Set<string>([
    ...certeza.filter((c: any) => c.produto_duplicado_para_excluir).map((c: any) => c.produto_duplicado_para_excluir),
    ...resolvido.filter((r: any) => r.produto_duplicado_para_excluir).map((r: any) => r.produto_duplicado_para_excluir),
  ]);

  return { mappingsToCreate, productsToDelete: Array.from(productsToDelete) };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Produtos KIT nunca devem ter mapping da Tecinco (só pneus unitários) ──
// Se algum internal_id da lista de criação for um KIT, tira ele da criação e
// manda pra lista de exclusão (mesmas checagens de dado transacional da fase 2).

async function separarKitsDaCriacao(
  rows: MappingRow[],
  productsToDelete: string[],
): Promise<{ rows: MappingRow[]; productsToDelete: string[] }> {
  const internalIds = rows.map((r) => r.internal_id);
  const products = await Product.findAll({
    where: { id: internalIds },
    attributes: ["id", "type"],
  });
  const kitIds = new Set(products.filter((p) => p.type === "KIT").map((p) => p.id));

  if (kitIds.size === 0) return { rows, productsToDelete };

  console.log(`  ⚠️  ${kitIds.size} produto(s) do tipo KIT encontrados na lista de mapping — kits nunca devem ter mapping Tecinco, movendo pra exclusão`);

  const filteredRows = rows.filter((r) => !kitIds.has(r.internal_id));
  const mergedDelete = Array.from(new Set([...productsToDelete, ...kitIds]));
  return { rows: filteredRows, productsToDelete: mergedDelete };
}

// ─── Kits que JÁ têm mapping Tecinco no banco (bug antigo) ─────────────────
// certeza.json/resolvido.json só usam produtos type=UNIT (dump-local-products.ts
// já filtra isso), então nunca criam mapping pra kit — mas pode haver kit com
// mapping Tecinco de ANTES desta sessão (resolveProductWithMapping antigo não
// filtrava por tipo). Precisa achar isso ANTES da fase 1 apagar os mappings,
// senão perde o rastro de qual produto era kit.

async function acharKitsComMappingAtual(integrationsId: string): Promise<string[]> {
  const mappings = await IntegrationMapping.findAll({
    where: { entity_type: "PRODUCT", integrations_id: integrationsId },
    attributes: ["internal_id"],
  });
  if (mappings.length === 0) return [];

  const products = await Product.findAll({
    where: { id: mappings.map((m) => m.internal_id) },
    attributes: ["id", "type"],
  });
  const kitIds = products.filter((p) => p.type === "KIT").map((p) => p.id);

  if (kitIds.length > 0) {
    console.log(`  ⚠️  ${kitIds.length} produto(s) KIT com mapping Tecinco atual (bug antigo) — kit nunca deveria ter mapping Tecinco, movendo pra exclusão`);
  }
  return kitIds;
}

// ─── Fase 1 — apaga mappings de PRODUCT da Tecinco ─────────────────────────

async function fase1ApagarMappings(integrationsId: string): Promise<void> {
  console.log("─".repeat(55));
  console.log("🗑  Fase 1 — apagar integration_mappings de PRODUCT (Tecinco)");
  console.log("─".repeat(55));

  const deleted = await IntegrationMapping.destroy({
    where: { entity_type: "PRODUCT", integrations_id: integrationsId },
  });
  console.log(`  ✅ ${deleted} mapping(s) removido(s)`);
}

// ─── Fase 2 — apaga produtos duplicados sem dado transacional pendurado ────

async function fase2ApagarProdutos(productIds: string[]): Promise<void> {
  console.log("\n" + "─".repeat(55));
  console.log(`🗑  Fase 2 — apagar produtos duplicados (${productIds.length} candidatos)`);
  console.log("─".repeat(55));

  let apagados = 0;
  let pulados = 0;

  for (const productId of productIds) {
    const [stockMovements, expeditionBatchItems, kitAsComponent] = await Promise.all([
      StockMovement.count({ where: { product_id: productId } }),
      ExpeditionBatchItems.count({ where: { product_id: productId } }),
      KitComponent.count({ where: { product_component_id: productId } }),
    ]);

    // stock_movements e expedition_batch_items bloqueiam (atividade real); o
    // resto (invoice_items, inventory_batch_items, order_items,
    // operation_items) não importa — é apagado junto com o produto.
    const bloqueios: string[] = [];
    if (stockMovements) bloqueios.push(`stock_movements=${stockMovements}`);
    if (expeditionBatchItems) bloqueios.push(`expedition_batch_items=${expeditionBatchItems}`);
    if (kitAsComponent) bloqueios.push(`kit_components(como componente)=${kitAsComponent}`);

    if (bloqueios.length > 0) {
      console.warn(`  ⚠️  ${productId} — PULADO, tem dado bloqueante: ${bloqueios.join(", ")}`);
      pulados++;
      continue;
    }

    await sequelize.transaction(async (transaction) => {
      await InvoiceItems.destroy({ where: { product_id: productId }, transaction });
      await InventoryBatchItems.destroy({ where: { product_id: productId }, transaction });
      await OrderItems.destroy({ where: { product_id: productId }, transaction });
      await OperationItems.destroy({ where: { product_id: productId }, transaction });
      await Stock.destroy({ where: { product_id: productId }, transaction });
      await ProductConfig.destroy({ where: { product_id: productId }, transaction });
      await SupplierMapping.destroy({ where: { product_id: productId }, transaction });
      await IntegrationMapping.destroy({ where: { entity_type: "PRODUCT", internal_id: productId }, transaction });
      await Product.destroy({ where: { id: productId }, transaction });
    });
    apagados++;
  }

  console.log(`  ✅ ${apagados} produto(s) apagado(s) | ⚠️  ${pulados} pulado(s) (tinham dado transacional)`);
}

// ─── Fase 3 — cria os mappings novos ────────────────────────────────────────

async function fase3CriarMappings(rows: MappingRow[], integrationsId: string): Promise<void> {
  console.log("\n" + "─".repeat(55));
  console.log(`✅ Fase 3 — criar integration_mappings (${rows.length} linhas)`);
  console.log("─".repeat(55));

  let criados = 0;
  for (const row of rows) {
    await integrationMappingService.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: row.internal_id,
      external_id: row.external_id,
      integrations_id: integrationsId,
    });
    criados++;
    if (criados % 200 === 0) console.log(`  → ${criados}/${rows.length}...`);
  }
  console.log(`  ✅ ${criados} mapping(s) processado(s)`);
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  await bootstrap();

  const loaded = loadInputs();
  const { rows: mappingsToCreate, productsToDelete } = await separarKitsDaCriacao(
    loaded.mappingsToCreate,
    loaded.productsToDelete,
  );

  console.log("\n" + "═".repeat(55));
  console.log("  🚀 Aplicar mappings Tecinco (certeza + resolvido)");
  console.log("═".repeat(55));
  console.log(`  Mappings a criar: ${mappingsToCreate.length}`);
  console.log(`  Produtos candidatos a exclusão: ${productsToDelete.length}`);
  console.log("═".repeat(55) + "\n");

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("  Confirmar e iniciar (apaga mappings, apaga produtos duplicados, cria mappings novos)? [s/N] ", (answer) => {
      rl.close();
      if (answer.toLowerCase() !== "s") {
        console.log("\n  Cancelado.\n");
        process.exit(0);
      }
      resolve();
    });
  });

  console.log("");

  const integration = await getTCarIntegration("Tecinco");

  const start = Date.now();
  try {
    const kitsComMappingAtual = await acharKitsComMappingAtual(integration.id);
    const productsToDeleteFinal = Array.from(new Set([...productsToDelete, ...kitsComMappingAtual]));

    await fase1ApagarMappings(integration.id);
    await fase2ApagarProdutos(productsToDeleteFinal);
    await fase3CriarMappings(mappingsToCreate, integration.id);
  } catch (err: any) {
    console.error("\n❌ Erro durante a aplicação:", err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("\n" + "═".repeat(55));
  console.log(`  ✅ Concluído em ${elapsed}s`);
  console.log("═".repeat(55));

  process.exit(0);
}

main();
