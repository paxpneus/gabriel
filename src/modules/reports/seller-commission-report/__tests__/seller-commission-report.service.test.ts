import { SellerCommissionReportService } from "../services/main/seller-commission-report/seller-commission-report.service";
import productService from "../../../inventory/products/services/product.service";
import contactService from "../../../sales/contacts/contacts.service";

jest.mock("../../../inventory/products/services/product.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

jest.mock("../../../sales/contacts/contacts.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

describe("SellerCommissionReportService", () => {
  const warnings = { orders_open: 2, orders_final_without_invoice: 1, orders_missing_cost: 0 };
  const repository = {
    findCommissionRows: jest.fn(),
    countOrderWarnings: jest.fn(),
  };
  const service = new SellerCommissionReportService(repository as any);

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findCommissionRows.mockResolvedValue([]);
    repository.countOrderWarnings.mockResolvedValue(warnings);
    (productService.findAll as jest.Mock).mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
  });

  it("busca linhas e avisos pelo período do pedido, com os mesmos filtros", async () => {
    const report = await service.getReport({ startDate: "2026-10-01", endDate: "2026-10-31", sellerIds: ["s1"] });

    const filters = { startDate: "2026-10-01", endDate: "2026-10-31", productIds: undefined, sellerIds: ["s1"], unitBusinessIds: undefined, originUnitBusinessIds: undefined };
    expect(repository.findCommissionRows).toHaveBeenCalledWith(filters);
    expect(repository.countOrderWarnings).toHaveBeenCalledWith(filters);
    expect(contactService.findAll).not.toHaveBeenCalled();
    expect(report.warnings).toEqual(warnings);
    expect(report.filters).toEqual({
      start_date: "2026-10-01", end_date: "2026-10-31", brand: null, product_id: null,
      seller_id: ["s1"], manager_id: null, unit_business_id: null, origin_unit_business_id: null,
    });
  });

  it("marca e produto viram a interseção de product_id", async () => {
    await service.getReport({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      brands: ["Marca Y"],
      productIds: ["p2", "p3"],
    });
    expect(repository.findCommissionRows.mock.calls[0][0].productIds).toEqual(["p2"]);
    expect(repository.countOrderWarnings.mock.calls[0][0].productIds).toEqual(["p2"]);
  });

  it("gerente (contato SELLER_MANAGER) vira a loja dele", async () => {
    (contactService.findAll as jest.Mock).mockResolvedValue([{ unit_business_id: "ub-9" }, { unit_business_id: null }]);
    await service.getReport({ startDate: "2026-10-01", endDate: "2026-10-31", managerIds: ["c1"] });

    expect((contactService.findAll as jest.Mock).mock.calls[0][0].where.type).toBe("SELLER_MANAGER");
    expect(repository.findCommissionRows.mock.calls[0][0].unitBusinessIds).toEqual(["ub-9"]);
  });

  it("loja e gerente juntos ficam com a interseção das lojas", async () => {
    (contactService.findAll as jest.Mock).mockResolvedValue([{ unit_business_id: "ub-1" }, { unit_business_id: "ub-9" }]);
    await service.getReport({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      managerIds: ["c1"],
      unitBusinessIds: ["ub-1", "ub-2"],
    });

    expect(repository.findCommissionRows.mock.calls[0][0].unitBusinessIds).toEqual(["ub-1"]);
  });
});
