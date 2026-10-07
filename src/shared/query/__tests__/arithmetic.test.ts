import {
  coalesceZero,
  markupPct,
  percentOf,
  roundTo,
  safeDivide,
  subtractAll,
} from "../sequelize-helpers/arithmetic";

describe("arithmetic sql helpers", () => {
  it("coalesceZero / roundTo", () => {
    expect(coalesceZero("a.x")).toBe("COALESCE(a.x, 0)");
    expect(roundTo("a.x")).toBe("ROUND((a.x)::numeric, 2)");
    expect(roundTo("a.x", 4)).toBe("ROUND((a.x)::numeric, 4)");
  });

  it("subtractAll coalesce cada parcela", () => {
    expect(subtractAll("a.base", ["a.d1", "a.d2"])).toBe(
      "COALESCE(a.base, 0) - COALESCE(a.d1, 0) - COALESCE(a.d2, 0)",
    );
    expect(subtractAll("a.base", [])).toBe("COALESCE(a.base, 0)");
  });

  it("safeDivide protege denominador zero/nulo", () => {
    expect(safeDivide("n", "d")).toBe(
      "CASE WHEN COALESCE(d, 0) = 0 THEN 0 ELSE ROUND(((n) / NULLIF((d), 0))::numeric, 2) END",
    );
  });

  it("percentOf multiplica por 100 antes de dividir", () => {
    expect(percentOf("p", "t")).toContain("((p) * 100) / NULLIF((t), 0)");
  });

  it("markupPct = (receita − custo) / custo em %", () => {
    const sql = markupPct("r", "c");
    expect(sql).toContain("(COALESCE(r, 0) - COALESCE(c, 0)) * 100");
    expect(sql).toContain("NULLIF((c), 0)");
  });
});
