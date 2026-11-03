import { SalesReturnReportService } from "../services/main/sales-return-report/sales-return-report.service";

jest.mock("../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  CD21_UNIT_BUSINESS_NUMBER: "21",
  default: { findOne: jest.fn().mockResolvedValue({ id: "ub-21" }) },
}));

describe("SalesReturnReportService", () => {
  const repository = {
    findReturnMovementIds: jest.fn(),
    findReturnLines: jest.fn(),
  };
  const service = new SalesReturnReportService(repository as any);

  beforeEach(() => {
    repository.findReturnMovementIds.mockResolvedValue(["m1", "m2"]);
    repository.findReturnLines.mockResolvedValue([]);
  });

  it("busca os movimentos de devolução do CD21 no período (dia inteiro em Brasília) e enriquece só eles", async () => {
    const report = await service.getReport({ startDate: "2026-05-01", endDate: "2026-05-31" });

    const [unitBusinessId, start, end] = repository.findReturnMovementIds.mock.calls[0];
    expect(unitBusinessId).toBe("ub-21");
    expect(start.toISOString()).toBe("2026-05-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-01T02:59:59.999Z");
    expect(repository.findReturnLines).toHaveBeenCalledWith(["m1", "m2"]);
    expect(report.filters).toEqual({ start_date: "2026-05-01", end_date: "2026-05-31", unit_business_id: "ub-21" });
  });
});
