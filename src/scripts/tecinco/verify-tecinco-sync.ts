/**
 * verify-tecinco-sync.ts
 *
 * Cruza o catálogo Tecinco (buscado ao vivo, igual migrateProdutos faz) com o
 * banco local pra confirmar que a proteção de sku/ean duplicado
 * (skuOmitted/eanOmitted, ver "Tecinco catalog-duplicate safety net" no
 * CLAUDE.md) está se comportando como esperado. Só leitura — nenhuma escrita
 * no banco nem chamada de criação/atualização na API Tecinco além da busca
 * de catálogo (mesmo endpoint de listagem que migrateProdutos usa).
 *
 * Reaproveita buildTecincoDuplicateValueSets/findTecincoCollidingFields de
 * tecinco-migration.runner.ts de propósito — assim essa verificação nunca
 * diverge da lógica real de duplicidade usada em produção.
 *
 * Checa 5 coisas, tudo escopado à integração Tecinco:
 *   1. Item duplicado (sku ou ean) com integration_mapping válido: ProductConfig
 *      não deve ter esse campo preenchido.
 *   2. Item duplicado com mapping válido: continua com ProductConfig (não
 *      bloqueado) e não aparece mais em unmapped.
 *   3. Item SEM duplicidade, com mapping válido: ProductConfig salvou sku
 *      (codigoFabrica ?? external_id) e gtin normalmente.
 *   4. SupplierMapping só existe pra códigos NÃO duplicados no catálogo.
 *   5. unmapped (catálogo, invoice_id null): type correto (ERROR_CATALOG vs
 *      ERROR_CATALOG_DUPLICATE) e nenhum duplicado sem mapping ficou de fora.
 *
 * Uso:
 *   npx ts-node src/scripts/tecinco/verify-tecinco-sync.ts
 */

import { Op } from "sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import { Product, ProductConfig, SupplierMapping } from "../../modules/inventory";
import { UnitBusiness } from "../../modules/warehouse";
import IntegrationMapping from "../../modules/integrations/integration-mapping/integration-mapping.model";
import UnmappedInvoiceProduct from "../../modules/inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import { getTCarIntegration } from "../../modules/handlers/tecinco/api/tecinco_api";
import { normalizeEan } from "../../modules/handlers/tecinco/queues/helpers/product.helpers";
import { fetchTecincoCatalog, TecincoCatalogItem } from "./dump-tecinco-catalog";
import {
  buildTecincoDuplicateValueSets,
  findTecincoCollidingFields,
} from "./tecinco-migration.runner";

interface Item extends TecincoCatalogItem {
  skuDuplicated: boolean;
  eanDuplicated: boolean;
  normEan?: string;
}

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  const integrations = await getTCarIntegration("Tecinco");

  const units = await UnitBusiness.findAll({
    attributes: ["id", "number"],
    where: { integrations_id: integrations.id },
  });
  const unitBusinessIds = units.map((u: any) => u.id);
  const branchIds = units
    .map((u: any) => Number(u.number))
    .filter((n: number) => !Number.isNaN(n));

  console.log(`🔍 Buscando catálogo Tecinco completo (${branchIds.length} filial(is))...`);
  const catalog = await fetchTecincoCatalog({ branchIds });
  console.log(`  ${catalog.length} itens carregados.\n`);

  const duplicateSets = buildTecincoDuplicateValueSets(catalog);

  const itemsById = new Map<string, Item>();
  for (const item of catalog) {
    const colliding = findTecincoCollidingFields(
      { coded: item.coded, sku: item.sku, ean: item.ean },
      duplicateSets,
    );
    itemsById.set(item.id_sistema, {
      ...item,
      normEan: normalizeEan(item.ean ?? undefined),
      skuDuplicated: colliding.some((f) => f.startsWith("sku=")),
      eanDuplicated: colliding.some((f) => f.startsWith("ean=")),
    });
  }
  const dupCount = [...itemsById.values()].filter((i) => i.skuDuplicated || i.eanDuplicated).length;
  console.log(`  itens com sku ou ean duplicado no catálogo: ${dupCount}\n`);

  // Mapeamentos válidos (produto ainda existe de fato)
  const mappingRows = await IntegrationMapping.findAll({
    where: { entity_type: "PRODUCT", integrations_id: integrations.id },
    attributes: ["external_id", "internal_id"],
  });
  const candidateProductIds = [...new Set(mappingRows.map((m: any) => m.internal_id))];
  const existingProducts = candidateProductIds.length
    ? await Product.findAll({ where: { id: { [Op.in]: candidateProductIds } }, attributes: ["id"] })
    : [];
  const existingProductIdSet = new Set(existingProducts.map((p: any) => p.id));
  const mappingByExternalId = new Map<string, string>();
  for (const m of mappingRows as any[]) {
    if (existingProductIdSet.has(m.internal_id)) mappingByExternalId.set(m.external_id, m.internal_id);
  }
  console.log(`Integration mappings válidos: ${mappingByExternalId.size}`);

  const configRows = unitBusinessIds.length
    ? await ProductConfig.findAll({
        where: { unit_business_id: { [Op.in]: unitBusinessIds } },
        attributes: ["product_id", "unit_business_id", "sku", "gtin", "gtin_package"],
      })
    : [];
  const configsByProduct = new Map<string, any[]>();
  for (const r of configRows as any[]) {
    if (!configsByProduct.has(r.product_id)) configsByProduct.set(r.product_id, []);
    configsByProduct.get(r.product_id)!.push(r);
  }
  console.log(`Product configs (unit businesses Tecinco): ${configRows.length}`);

  const supplierRows = await SupplierMapping.findAll({
    where: { integrations_id: integrations.id },
    attributes: ["product_id", "supplier_product_code"],
  });
  console.log(`SupplierMappings Tecinco: ${supplierRows.length}`);

  const unmappedRows = await UnmappedInvoiceProduct.findAll({
    where: { integrations_id: integrations.id, invoice_id: null },
    attributes: ["external_id", "type", "sku", "ean", "product_name"],
  });
  const unmappedByExternalId = new Map((unmappedRows as any[]).map((r) => [r.external_id, r]));
  console.log(`Unmapped (catálogo, invoice_id null) Tecinco: ${unmappedRows.length}\n`);

  let totalViolations = 0;

  console.log("=".repeat(70));
  console.log("CHECK 1 — item duplicado com mapping válido: ProductConfig omite o campo");
  console.log("=".repeat(70));
  let c1Sku: any[] = [];
  let c1Ean: any[] = [];
  let c1Checked = 0;
  for (const item of itemsById.values()) {
    if (!item.skuDuplicated && !item.eanDuplicated) continue;
    const productId = mappingByExternalId.get(item.id_sistema);
    if (!productId) continue;
    c1Checked++;
    const configs = configsByProduct.get(productId) ?? [];
    if (item.skuDuplicated) {
      for (const cfg of configs) if (cfg.sku) c1Sku.push({ ext: item.id_sistema, nome: item.nome, sku: cfg.sku });
    }
    if (item.eanDuplicated) {
      for (const cfg of configs) if (cfg.gtin) c1Ean.push({ ext: item.id_sistema, nome: item.nome, gtin: cfg.gtin });
    }
  }
  console.log(`Itens duplicados com mapping válido: ${c1Checked}`);
  console.log(`Violações sku: ${c1Sku.length}`);
  c1Sku.slice(0, 10).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}" sku=${v.sku}`));
  console.log(`Violações gtin: ${c1Ean.length}`);
  c1Ean.slice(0, 10).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}" gtin=${v.gtin}`));
  totalViolations += c1Sku.length + c1Ean.length;

  console.log("\n" + "=".repeat(70));
  console.log("CHECK 2 — item duplicado com mapping válido: continua sincronizado, sem virar unmapped");
  console.log("=".repeat(70));
  let c2Missing: any[] = [];
  let c2Wrongly: any[] = [];
  for (const item of itemsById.values()) {
    if (!item.skuDuplicated && !item.eanDuplicated) continue;
    const productId = mappingByExternalId.get(item.id_sistema);
    if (!productId) continue;
    const configs = configsByProduct.get(productId) ?? [];
    if (configs.length === 0) c2Missing.push({ ext: item.id_sistema, nome: item.nome });
    if (unmappedByExternalId.has(item.id_sistema)) c2Wrongly.push({ ext: item.id_sistema, nome: item.nome });
  }
  console.log(`Duplicados com mapping mas sem ProductConfig: ${c2Missing.length}`);
  c2Missing.slice(0, 10).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}"`));
  console.log(`Duplicados com mapping mas ainda em unmapped: ${c2Wrongly.length}`);
  c2Wrongly.slice(0, 10).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}"`));
  totalViolations += c2Missing.length + c2Wrongly.length;

  console.log("\n" + "=".repeat(70));
  console.log("CHECK 3 — item SEM duplicidade, com mapping válido: sku/gtin salvos normal");
  console.log("=".repeat(70));
  let c3Sku: any[] = [];
  let c3Gtin: any[] = [];
  let c3Checked = 0;
  for (const item of itemsById.values()) {
    if (item.skuDuplicated || item.eanDuplicated) continue;
    const productId = mappingByExternalId.get(item.id_sistema);
    if (!productId) continue;
    const configs = configsByProduct.get(productId) ?? [];
    if (configs.length === 0) continue;
    c3Checked++;
    // Persistido como codigoFabrica ?? systemId (ver createProductFromTCarData
    // / ProductConfig.upsert em tecinco-api-fetch.queue.ts) — não é o mesmo
    // fallback usado pra detectar duplicidade (que cai pro epctb_coded).
    const expectedSku = item.sku?.trim() || item.id_sistema;
    if (!configs.some((c) => c.sku === expectedSku)) {
      c3Sku.push({ ext: item.id_sistema, nome: item.nome, esperado: expectedSku, got: configs.map((c) => c.sku) });
    }
    if (item.normEan && !configs.some((c) => c.gtin === item.normEan)) {
      c3Gtin.push({ ext: item.id_sistema, nome: item.nome, esperado: item.normEan, got: configs.map((c) => c.gtin) });
    }
  }
  console.log(`Itens não-duplicados com mapping e config: ${c3Checked}`);
  console.log(`Sem sku esperado: ${c3Sku.length}`);
  c3Sku.slice(0, 10).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}" esperado=${v.esperado} got=[${v.got}]`));
  console.log(`Sem gtin esperado: ${c3Gtin.length}`);
  c3Gtin.slice(0, 10).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}" esperado=${v.esperado} got=[${v.got}]`));
  totalViolations += c3Sku.length + c3Gtin.length;

  console.log("\n" + "=".repeat(70));
  console.log("CHECK 4 — SupplierMappings só existem pra código NÃO duplicado no catálogo");
  console.log("=".repeat(70));
  let c4: any[] = [];
  for (const row of supplierRows as any[]) {
    const code = row.supplier_product_code;
    if (duplicateSets.sku.has(code) || duplicateSets.ean.has(code)) {
      c4.push({ productId: row.product_id, code });
    }
  }
  console.log(`SupplierMappings verificados: ${supplierRows.length}`);
  console.log(`Violações: ${c4.length}`);
  c4.slice(0, 10).forEach((v) => console.log(`  ✗ product_id=${v.productId} code=${v.code}`));
  totalViolations += c4.length;

  console.log("\n" + "=".repeat(70));
  console.log("CHECK 5 — unmapped: type correto + completude");
  console.log("=".repeat(70));
  let c5Mismatch: any[] = [];
  for (const row of unmappedRows as any[]) {
    const item = itemsById.get(row.external_id);
    if (!item) continue;
    const expected = item.skuDuplicated || item.eanDuplicated ? "ERROR_CATALOG_DUPLICATE" : "ERROR_CATALOG";
    if (row.type !== expected) {
      c5Mismatch.push({ ext: row.external_id, nome: row.product_name, esperado: expected, got: row.type });
    }
  }
  let c5Missing: any[] = [];
  for (const item of itemsById.values()) {
    if (!item.skuDuplicated && !item.eanDuplicated) continue;
    if (mappingByExternalId.has(item.id_sistema)) continue;
    if (!unmappedByExternalId.has(item.id_sistema)) c5Missing.push({ ext: item.id_sistema, nome: item.nome });
  }
  console.log(`Unmapped verificados: ${unmappedRows.length}`);
  console.log(`Mismatch de type: ${c5Mismatch.length}`);
  c5Mismatch.slice(0, 15).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}" esperado=${v.esperado} got=${v.got}`));
  console.log(`Duplicados sem mapping e sem unmapped nenhum: ${c5Missing.length}`);
  c5Missing.slice(0, 15).forEach((v) => console.log(`  ✗ ${v.ext} "${v.nome}"`));
  totalViolations += c5Mismatch.length + c5Missing.length;

  console.log("\n" + "=".repeat(70));
  console.log(`RESUMO — total de violações: ${totalViolations}`);
  console.log("=".repeat(70));

  process.exit(totalViolations > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
