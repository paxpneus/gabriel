import { ProductStockFlowQuerySchema } from "../controllers/product-stock-flow.controller";

jest.mock("../../../../middlewares/auth-token", () => ({
  authenticate: jest.fn(),
}));
jest.mock("../../../../middlewares/user-permissions", () => ({
  userPermissions: jest.fn(),
}));
jest.mock("../services/main/product-stock-flow/product-stock-flow.service", () => ({
  __esModule: true,
  default: { getReport: jest.fn() },
}));

describe("ProductStockFlowQuerySchema", () => {
  const parse = (query: unknown) => ProductStockFlowQuerySchema.safeParse(query);

  it("aceita período válido", () => {
    expect(parse({ start_date: "2026-05-01", end_date: "2026-06-30" }).success).toBe(true);
    expect(parse({ start_date: "2026-05-01", end_date: "2026-05-01" }).success).toBe(true);
  });

  it("exige as duas datas", () => {
    expect(parse({ start_date: "2026-05-01" }).success).toBe(false);
    expect(parse({ end_date: "2026-05-01" }).success).toBe(false);
  });

  it("rejeita formato inválido e data inexistente", () => {
    expect(parse({ start_date: "01/05/2026", end_date: "2026-05-01" }).success).toBe(false);
    expect(parse({ start_date: "2026-02-30", end_date: "2026-03-01" }).success).toBe(false);
  });

  it("normaliza brand único ou múltiplo para array", () => {
    const period = { start_date: "2026-05-01", end_date: "2026-05-31" };

    expect(parse({ ...period, brand: "MICHELIN" }).data?.brand).toEqual(["MICHELIN"]);
    expect(parse({ ...period, brand: ["MICHELIN", "PIRELLI"] }).data?.brand).toEqual(["MICHELIN", "PIRELLI"]);
    expect(parse(period).data?.brand).toBeUndefined();
  });

  it("normaliza loja da venda única ou múltipla para array e rejeita id inválido", () => {
    const period = { start_date: "2026-05-01", end_date: "2026-05-31" };
    const ub1 = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";
    const ub2 = "0f6d1c2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";

    expect(parse({ ...period, sale_unit_business_id: ub1 }).data?.sale_unit_business_id).toEqual([ub1]);
    expect(parse({ ...period, sale_unit_business_id: [ub1, ub2] }).data?.sale_unit_business_id).toEqual([ub1, ub2]);
    expect(parse(period).data?.sale_unit_business_id).toBeUndefined();
    expect(parse({ ...period, sale_unit_business_id: "loja-1" }).success).toBe(false);
  });

  it("rejeita start_date posterior a end_date", () => {
    const result = parse({ start_date: "2026-06-01", end_date: "2026-05-01" });

    expect(result.success).toBe(false);
  });
});
