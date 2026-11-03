import {
  proratedSaleItemColumnsSql,
  returnFactorSql,
} from "../repositories/query-objects/sales-return-report.attributes";

describe("sales return report attributes", () => {
  it("fator usa unidades vendidas (qtd × kit_multiplier) e não divide por zero", () => {
    expect(returnFactorSql("fi", "m")).toBe(
      "fi.quantity / NULLIF(m.quantity * COALESCE(m.kit_multiplier, 1), 0)",
    );
  });

  it("valores da venda multiplicados pelo fator, 0 sem item casado", () => {
    const sql = proratedSaleItemColumnsSql("soi");
    expect(sql).toContain("COALESCE(ROUND(soi.net_value * soi.factor, 2), 0) AS net_value");
    expect(sql).toContain("COALESCE(ROUND(soi.total_cost_snapshot * soi.factor, 2), 0) AS total_cost");
    expect(sql).toContain("COALESCE(ROUND(soi.contribution_value * soi.factor, 2), 0) AS contribution_value");
  });
});
