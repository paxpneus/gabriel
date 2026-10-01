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

  it("rejeita start_date posterior a end_date", () => {
    const result = parse({ start_date: "2026-06-01", end_date: "2026-05-01" });

    expect(result.success).toBe(false);
  });
});
