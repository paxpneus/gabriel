import { SalesInvoicedReportQuerySchema } from "../controllers/sales-invoiced-report.controller";

jest.mock("../../../../middlewares/auth-token", () => ({
  authenticate: jest.fn(),
}));
jest.mock("../../../../middlewares/user-permissions", () => ({
  userPermissions: jest.fn(),
}));
jest.mock("../services/main/sales-invoiced-report/sales-invoiced-report.service", () => ({
  __esModule: true,
  default: { getReport: jest.fn() },
}));

describe("SalesInvoicedReportQuerySchema", () => {
  const parse = (query: unknown) => SalesInvoicedReportQuerySchema.safeParse(query);

  it("aceita período válido", () => {
    expect(parse({ start_date: "2026-05-01", end_date: "2026-05-31" }).success).toBe(true);
  });

  it("exige as duas datas", () => {
    expect(parse({ start_date: "2026-05-01" }).success).toBe(false);
    expect(parse({ end_date: "2026-05-01" }).success).toBe(false);
  });

  it("rejeita formato inválido, data inexistente e período invertido", () => {
    expect(parse({ start_date: "01/05/2026", end_date: "2026-05-01" }).success).toBe(false);
    expect(parse({ start_date: "2026-02-30", end_date: "2026-03-01" }).success).toBe(false);
    expect(parse({ start_date: "2026-06-01", end_date: "2026-05-01" }).success).toBe(false);
  });
});
