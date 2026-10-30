/**
 * Alinha `stocks.quantity` com o saldo físico da Bling (e as colunas só leitura reserved_quantity/virtual_stock com o virtual) (`/estoques/saldos`, em lote) só pros produtos divergentes.
 * Uso: npx ts-node src/scripts/bling/sync-stock-from-bling.ts [--apply] (sem --apply só lista, não grava).
 * Também roda a cada 5min pela fila BLING_STOCK_SYNC (sempre gravando).
 */
import { Op } from "sequelize";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import { blingApi, getBlingIntegration } from "../../modules/handlers/bling/api/bling_api.service";
import { blingGet } from "../../modules/handlers/bling/services/bling/helpers/get-with-sleep";
import integrationMappingService from "../../modules/integrations/integration-mapping/integration-mapping.service";
import product_configService from "../../modules/inventory/product-config/product_config.service";
import productService from "../../modules/inventory/products/services/product.service";
import stockService from "../../modules/inventory/stock/stock/stock.service";

// idsProdutos[] por chamada: a Bling corta pelo tamanho da URL (~8 KB, 414 a partir de ~300 ids); 200 deixa margem.
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 200);

// Compara saldo físico da Bling com `stocks` e grava só os divergentes (dryRun: só lista); usado pelo CLI e pela fila.
export async function syncStockFromBling(
  dryRun: boolean,
): Promise<{ divergent: number; failedBatches: number }> {
  // Mesma unit business que o webhook de produto/estoque da Bling usa; lida aqui, não no import (dotenv pode vir depois).
  const UNIT_BUSINESS_ID = process.env.BLING_UNIT_BUSINESS_ID;
  if (!UNIT_BUSINESS_ID) throw new Error("BLING_UNIT_BUSINESS_ID não definido");

  // Só mapping principal — o webhook também não grava estoque por mapping não principal.
  const integration = await getBlingIntegration();
  const mappings = await integrationMappingService.findAll({
    where: { entity_type: "PRODUCT", integrations_id: integration.id, is_primary: true },
    attributes: ["external_id", "internal_id"],
  });
  const productIdByBlingId = new Map(mappings.map((m) => [m.external_id, m.internal_id]));
  const blingIds = [...productIdByBlingId.keys()];
  console.log(`[SYNC_STOCK] ${blingIds.length} produto(s) mapeados na Bling`);

  // Saldo físico e virtual da Bling por product_id; lote que falhar é só logado e pulado.
  const blingQuantityByProductId = new Map<string, number>();
  const blingVirtualByProductId = new Map<string, number>();
  let failedBatches = 0;
  for (let i = 0; i < blingIds.length; i += BATCH_SIZE) {
    const batch = blingIds.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams();
    batch.forEach((id) => params.append("idsProdutos[]", id));
    try {
      const { data } = await blingGet<{
        data: Array<{ produto: { id: number }; saldoFisicoTotal: number; saldoVirtualTotal: number }>;
      }>(`/estoques/saldos?${params.toString()}`, blingApi);
      for (const s of data?.data ?? []) {
        const productId = productIdByBlingId.get(String(s.produto.id));
        if (!productId) continue;
        blingQuantityByProductId.set(productId, Number(s.saldoFisicoTotal ?? 0));
        // sem saldo virtual na resposta = sem reserva (virtual = físico)
        blingVirtualByProductId.set(productId, Number(s.saldoVirtualTotal ?? s.saldoFisicoTotal ?? 0));
      }
    } catch (error: any) {
      failedBatches++;
      console.error(`[SYNC_STOCK] Falha no lote ${i / BATCH_SIZE + 1}: ${error?.response?.status ?? ""} ${error?.message}`);
    }
    console.log(`[SYNC_STOCK] Saldos consultados: ${Math.min(i + BATCH_SIZE, blingIds.length)}/${blingIds.length}`);
  }

  const productIds = [...blingQuantityByProductId.keys()];
  const [stocks, configs] = await Promise.all([
    stockService.findAll({
      where: { unit_business_id: UNIT_BUSINESS_ID, product_id: { [Op.in]: productIds } },
      attributes: ["product_id", "quantity", "virtual_stock"],
    }),
    product_configService.findAll({
      where: { unit_business_id: UNIT_BUSINESS_ID, product_id: { [Op.in]: productIds } },
      attributes: ["product_id", "sku", "average_cost"],
    }),
  ]);
  const localQuantityByProductId = new Map(stocks.map((s) => [s.product_id, Number(s.quantity)]));
  const localVirtualByProductId = new Map(
    stocks.map((s) => [s.product_id, s.virtual_stock == null ? null : Number(s.virtual_stock)]),
  );
  const configByProductId = new Map(configs.map((c) => [c.product_id, c]));

  // Divergente = sem linha de stock, quantidade ou virtual diferente (reserva nova sem mudar o físico também grava);
  // saldo negativo na Bling é anomalia, não grava (igual ao webhook).
  let divergent: Array<{
    productId: string;
    local: number | null;
    bling: number;
    localVirtual: number | null;
    blingVirtual: number;
  }> = [];
  const negative: Array<{ productId: string; bling: number }> = [];
  for (const [productId, bling] of blingQuantityByProductId) {
    const local = localQuantityByProductId.get(productId) ?? null;
    const localVirtual = localVirtualByProductId.get(productId) ?? null;
    const blingVirtual = blingVirtualByProductId.get(productId) ?? bling;
    if (local === bling && localVirtual === blingVirtual) continue;
    if (bling < 0) negative.push({ productId, bling });
    else divergent.push({ productId, local, bling, localVirtual, blingVirtual });
  }

  const products = await productService.findAll({
    where: { id: { [Op.in]: [...divergent, ...negative].map((d) => d.productId) } },
    attributes: ["id", "name"],
  });
  const nameByProductId = new Map(products.map((p) => [p.id, p.name]));

  // internal_id não é FK: mapping órfão (produto apagado) derrubaria o upsert inteiro na FK de stocks — pula e lista.
  const orphans = divergent.filter((d) => !nameByProductId.has(d.productId));
  divergent = divergent.filter((d) => nameByProductId.has(d.productId));
  const label = (productId: string) =>
    `sku=${configByProductId.get(productId)?.sku ?? "-"} | ${nameByProductId.get(productId) ?? productId}`;

  console.log("═".repeat(60));
  console.log(`[SYNC_STOCK] Divergentes: ${divergent.length}`);
  for (const d of divergent) {
    console.log(
      `  · ${label(d.productId)} | hub=${d.local ?? "sem stock"} → bling=${d.bling} | virtual hub=${d.localVirtual ?? "-"} → bling=${d.blingVirtual}`,
    );
  }
  if (negative.length) {
    console.log(`[SYNC_STOCK] Saldo negativo na Bling (não gravado): ${negative.length}`);
    for (const n of negative) console.log(`  · ${label(n.productId)} | bling=${n.bling}`);
  }
  if (orphans.length) {
    console.log(`[SYNC_STOCK] Mapping apontando pra produto inexistente (não gravado): ${orphans.length}`);
    for (const o of orphans) console.log(`  · product_id=${o.productId} | bling=${o.bling}`);
  }

  // Upsert num comando só (unique product_id + unit_business_id); total_price segue o webhook: qty * custo médio.
  // reserved_quantity/virtual_stock são só leitura: físico - virtual e virtual da Bling.
  if (!dryRun && divergent.length) {
    await stockService.bulkCreate(
      divergent.map((d) => ({
        product_id: d.productId,
        unit_business_id: UNIT_BUSINESS_ID,
        quantity: d.bling,
        total_price: d.bling * Number(configByProductId.get(d.productId)?.average_cost ?? 0),
        reserved_quantity: d.bling - d.blingVirtual,
        virtual_stock: d.blingVirtual,
      })),
      {
        updateOnDuplicate: ["quantity", "total_price", "reserved_quantity", "virtual_stock", "updatedAt"],
        conflictAttributes: ["product_id", "unit_business_id"],
      },
    );
  }

  console.log("═".repeat(60));
  console.log(`  Modo: ${dryRun ? "DRY_RUN (nada gravado)" : "EXECUÇÃO REAL"}`);
  console.log(`  Mapeados: ${blingIds.length} | com saldo na Bling: ${productIds.length}`);
  console.log(`  Divergentes ${dryRun ? "encontrados" : "atualizados"}: ${divergent.length}`);
  console.log(`  Lotes com falha: ${failedBatches}`);
  console.log("═".repeat(60));

  return { divergent: divergent.length, failedBatches };
}

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  // Flag de CLI, não env: o .env tem DRY_RUN=false global e gravaria sem querer.
  const { failedBatches } = await syncStockFromBling(!process.argv.includes("--apply"));
  process.exit(failedBatches > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("\n❌ Erro fatal:", error);
    process.exit(1);
  });
}
