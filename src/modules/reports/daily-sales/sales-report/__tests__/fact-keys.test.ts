import { chunkArray, factKeysTableSql, uniqueBy } from "../helpers/fact-keys";

describe("fact keys helpers", () => {
  it("monta tabela de chaves a partir de jsonb, sem repetir chave", () => {
    expect(
      factKeysTableSql([
        { name: "fact_date", type: "date" },
        { name: "unit_business_id", type: "uuid" },
      ]),
    ).toBe(
      "SELECT DISTINCT * FROM jsonb_to_recordset(CAST(:keys AS jsonb)) AS k(fact_date date, unit_business_id uuid)",
    );
  });

  it("divide em lotes do tamanho pedido, último lote com o resto", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 2)).toEqual([]);
  });

  it("deduplica pela chave informada mantendo a última ocorrência", () => {
    const items = [
      { d: "2026-05-01", u: "a", v: 1 },
      { d: "2026-05-01", u: "a", v: 2 },
      { d: "2026-05-01", u: "b", v: 3 },
    ];
    expect(uniqueBy(items, (i) => `${i.d}:${i.u}`)).toEqual([
      { d: "2026-05-01", u: "a", v: 2 },
      { d: "2026-05-01", u: "b", v: 3 },
    ]);
  });
});
