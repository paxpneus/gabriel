/**
 * dump-local-products.ts
 *
 * Extrai TODOS os produtos do sistema local para um JSON simples em disco —
 * sem escrever nada no banco. Par de dump-tecinco-catalog.ts: os dois JSONs
 * são comparados manualmente (fora deste script) para decidir o matching
 * Tecinco → produto local.
 *
 * Uso:
 *   npx ts-node src/scripts/tecinco/dump-local-products.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fn, col } from "sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import { Product, ProductConfig, Group, Subgroup } from "../../modules/inventory";
import Brand from "../../modules/inventory/brands/brands.model";
import InvoiceItems from "../../modules/warehouse/fiscal/invoices/invoice-items/invoice-items.model";
import StockMovement from "../../modules/inventory/stock/stock-movements/stock-movements.model";

// Unit business Bling — única fonte de ProductConfig.sku confirmada não
// contaminada por resoluções erradas anteriores (ver contexto da sessão).
const BLING_UNIT_BUSINESS_ID = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";

export interface LocalProductCatalogItem {
  id: string;
  name: string;
  ean: string | null;
  ean_tribut: string | null;
  id_system: string | null;
  sku: string | null;
  marca: string | null;
  grupo: string | null;
  subgrupo: string | null;
  stock_movements_count: number;
  invoice_items_count: number;
}

const OUTPUT_PATH = path.join(__dirname, "output", "local-products-catalog.json");

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  console.log("═".repeat(55));
  console.log("  📥 Dump de produtos locais");
  console.log("═".repeat(55));

  const products = await Product.findAll({
    attributes: ["id", "name", "ean", "ean_tribut", "id_system"],
    where: { type: "UNIT" },
    include: [
      { model: Brand, as: "brandRegister", attributes: ["name"], required: false },
      {
        model: Subgroup,
        as: "subgroup",
        attributes: ["name"],
        required: false,
        include: [{ model: Group, as: "group", attributes: ["name"], required: false }],
      },
    ],
  });

  const configs = await ProductConfig.findAll({
    where: { unit_business_id: BLING_UNIT_BUSINESS_ID },
    attributes: ["product_id", "sku"],
  });
  const skuByProductId = new Map<string, string>();
  for (const c of configs) {
    if (c.sku) skuByProductId.set(c.product_id, c.sku);
  }

  const stockMovementCounts = (await StockMovement.findAll({
    attributes: ["product_id", [fn("COUNT", col("id")), "count"]],
    group: ["product_id"],
    raw: true,
  })) as unknown as Array<{ product_id: string; count: string }>;
  const stockMovementCountByProductId = new Map(
    stockMovementCounts.map((row) => [row.product_id, Number(row.count)]),
  );

  const invoiceItemCounts = (await InvoiceItems.findAll({
    attributes: ["product_id", [fn("COUNT", col("id")), "count"]],
    group: ["product_id"],
    raw: true,
  })) as unknown as Array<{ product_id: string; count: string }>;
  const invoiceItemCountByProductId = new Map(
    invoiceItemCounts.map((row) => [row.product_id, Number(row.count)]),
  );

  const items: LocalProductCatalogItem[] = products.map((p: any) => ({
    id: p.id,
    name: p.name,
    ean: p.ean ?? null,
    ean_tribut: p.ean_tribut ?? null,
    id_system: p.id_system ?? null,
    sku: skuByProductId.get(p.id) ?? null,
    marca: p.brandRegister?.name ?? null,
    grupo: p.subgroup?.group?.name ?? null,
    subgrupo: p.subgroup?.name ?? null,
    stock_movements_count: stockMovementCountByProductId.get(p.id) ?? 0,
    invoice_items_count: invoiceItemCountByProductId.get(p.id) ?? 0,
  }));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2));

  console.log("─".repeat(55));
  console.log(`  ✅ Total: ${items.length} produto(s)`);
  console.log(`  💾 Salvo em: ${OUTPUT_PATH}`);
  console.log("═".repeat(55));

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erro ao extrair produtos locais:", err);
  process.exit(1);
});
