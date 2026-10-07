import {
  DAILY_SALES_FACT_TABLES,
  deleteOrphanFactsSql,
} from "../helpers/orphan-facts";

const specFor = (table: string) => {
  const spec = DAILY_SALES_FACT_TABLES.find((s) => s.factTable === table);
  if (!spec) throw new Error(`missing spec for ${table}`);
  return spec;
};

describe("orphan facts cleanup sql", () => {
  it("cobre todas as tabelas de fact do sales report", () => {
    expect(DAILY_SALES_FACT_TABLES.map((s) => s.factTable).sort()).toEqual(
      [
        "daily_sales_facts",
        "daily_sales_product_facts",
        "daily_sales_state_facts",
        "daily_sales_status_facts",
        "daily_sales_store_facts",
      ].sort(),
    );
  });

  it("daily_sales_facts: apaga linha de dia+loja sem nenhum snapshot", () => {
    expect(deleteOrphanFactsSql(specFor("daily_sales_facts"))).toBe(
      "DELETE FROM daily_sales_facts f WHERE NOT EXISTS (SELECT 1 FROM sales_order_snapshots snap" +
        " WHERE snap.order_date = f.fact_date AND snap.unit_business_id = f.unit_business_id)",
    );
  });

  it("product facts comparam com os snapshots de item, por sku", () => {
    const sql = deleteOrphanFactsSql(specFor("daily_sales_product_facts"));
    expect(sql).toContain("FROM sales_order_item_snapshots snap");
    expect(sql).toContain("snap.sku = f.sku");
  });

  it("status facts mapeiam status_normalized para status_snapshot", () => {
    const sql = deleteOrphanFactsSql(specFor("daily_sales_status_facts"));
    expect(sql).toContain("snap.integration_id = f.integration_id");
    expect(sql).toContain("snap.status_snapshot = f.status_normalized");
  });
});
