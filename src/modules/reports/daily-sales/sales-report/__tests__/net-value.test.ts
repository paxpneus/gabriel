import { itemNetValueSql, orderNetValueSql } from "../helpers/net-value";

describe("net value sql", () => {
  it("item: commission_base − taxa − frete − ICMS − comissão do vendedor", () => {
    expect(itemNetValueSql()).toBe(
      "ROUND((COALESCE(commission_base, 0) - COALESCE(tax_commission_allocated, 0)" +
        " - COALESCE(freight_cost_allocated, 0) - COALESCE(computed_icms_value_allocated, 0)" +
        " - COALESCE(commission_value, 0))::numeric, 2)",
    );
  });

  it("item com alias prefixa as colunas", () => {
    expect(itemNetValueSql("sois")).toContain("COALESCE(sois.commission_base, 0)");
  });

  it("pedido: (produtos − desconto) − taxa − frete − ICMS − comissão vinda do rollup", () => {
    expect(orderNetValueSql("sos", "it.total_commission")).toBe(
      "ROUND((COALESCE(COALESCE(sos.total_products, 0) - COALESCE(sos.discount_value, 0), 0)" +
        " - COALESCE(sos.tax_commission, 0) - COALESCE(sos.freight_cost, 0)" +
        " - COALESCE(sos.computed_icms_value, 0) - COALESCE(it.total_commission, 0))::numeric, 2)",
    );
  });
});
