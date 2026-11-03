import { SalesReturnReportService } from "../services/main/sales-return-report/sales-return-report.service";
import productService from "../../../inventory/products/services/product.service";

jest.mock("../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  CD21_UNIT_BUSINESS_NUMBER: "21",
  default: { findOne: jest.fn().mockResolvedValue({ id: "ub-21" }) },
}));

jest.mock("../../../inventory/products/services/product.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

describe("SalesReturnReportService", () => {
  const repository = {
    findReturnMovementIds: jest.fn(),
    findReturnLines: jest.fn(),
    findReturnInvoiceCandidatesWithoutMovement: jest.fn(),
  };
  const service = new SalesReturnReportService(repository as any);

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findReturnMovementIds.mockResolvedValue(["m1", "m2"]);
    repository.findReturnLines.mockResolvedValue([]);
    repository.findReturnInvoiceCandidatesWithoutMovement.mockResolvedValue([]);
    (productService.findAll as jest.Mock).mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
  });

  it("busca os movimentos de devolução do CD21 no período (dia inteiro em Brasília) e enriquece só eles", async () => {
    const report = await service.getReport({ startDate: "2026-05-01", endDate: "2026-05-31" });

    const [unitBusinessId, start, end, productIds] = repository.findReturnMovementIds.mock.calls[0];
    expect(unitBusinessId).toBe("ub-21");
    expect(start.toISOString()).toBe("2026-05-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-01T02:59:59.999Z");
    expect(productIds).toBeUndefined();
    expect(productService.findAll).not.toHaveBeenCalled();
    expect(repository.findReturnLines).toHaveBeenCalledWith(["m1", "m2"]);
    expect(report.filters).toEqual({
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      unit_business_id: "ub-21",
      brand: null,
      product_id: null,
    });
  });

  it("nota sem movimento só conta quando o XML diz devolução (finNFe = 4)", async () => {
    repository.findReturnInvoiceCandidatesWithoutMovement.mockResolvedValue([
      { invoice_number: "100", xml_head: "<ide><tpNF>0</tpNF><finNFe>4</finNFe></ide>" },
      { invoice_number: "101", xml_head: "<ide><tpNF>0</tpNF><finNFe>1</finNFe></ide>" },
      { invoice_number: "102", xml_head: null },
    ]);
    const report = await service.getReport({ startDate: "2026-05-01", endDate: "2026-05-31", productIds: ["p1"] });

    expect(repository.findReturnInvoiceCandidatesWithoutMovement.mock.calls[0][3]).toEqual(["p1"]);
    expect(report.warnings.invoices_without_movement).toEqual({ count: 1, invoice_numbers: ["100"] });
    expect(report.warnings.movements_without_invoice).toEqual({ count: 0, invoice_numbers: [] });
  });

  it("marca vira lista de produtos", async () => {
    await service.getReport({ startDate: "2026-05-01", endDate: "2026-05-31", brands: ["Marca Y"] });
    expect(repository.findReturnMovementIds.mock.calls[0][3]).toEqual(["p1", "p2"]);
  });

  it("produto e marca juntos ficam com a interseção", async () => {
    const report = await service.getReport({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      brands: ["Marca Y"],
      productIds: ["p2", "p3"],
    });
    expect(repository.findReturnMovementIds.mock.calls[0][3]).toEqual(["p2"]);
    expect(report.filters.product_id).toEqual(["p2", "p3"]);
  });
});
