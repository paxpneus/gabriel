import { SellerCommissionReportService } from "../services/main/seller-commission-report/seller-commission-report.service";
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

describe("SellerCommissionReportService", () => {
  const repository = {
    findSaleMovementIds: jest.fn(),
    findInvoicesWithoutMovement: jest.fn(),
    findMovementInvoices: jest.fn(),
    findCommissionRows: jest.fn(),
    findManagerUnitBusinessIds: jest.fn(),
  };
  const service = new SellerCommissionReportService(repository as any);

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findSaleMovementIds.mockResolvedValue(["m1"]);
    repository.findInvoicesWithoutMovement.mockResolvedValue([]);
    repository.findMovementInvoices.mockResolvedValue([
      {
        invoice_key: "inv-1", invoice_id: "inv-1", invoice_number: "1001", is_order_adjustment: false,
        movement_date: "2026-10-05", invoice_cancelled: false, has_return_invoice: false, has_return: false, return_invoice_number: null, order_id: "o1", order_number: "P1",
        seller_id: "s1", unit_business_id: "ub-1", has_seller: true, snapshot_items: 1,
        has_cost_data: true, is_valid_sale: true,
      },
    ]);
    repository.findCommissionRows.mockResolvedValue([]);
    repository.findManagerUnitBusinessIds.mockResolvedValue(["ub-1"]);
    (productService.findAll as jest.Mock).mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
  });

  it("busca as saídas do CD21 no período (dia inteiro em Brasília) e os itens só dos pedidos que entraram", async () => {
    const report = await service.getReport({ startDate: "2026-10-01", endDate: "2026-10-31" });

    const [unitBusinessId, start, end, productIds] = repository.findSaleMovementIds.mock.calls[0];
    expect(unitBusinessId).toBe("ub-21");
    expect(start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T02:59:59.999Z");
    expect(productIds).toBeUndefined();
    expect(repository.findMovementInvoices).toHaveBeenCalledWith(["m1"]);
    expect(repository.findCommissionRows).toHaveBeenCalledWith(["o1"], {
      productIds: undefined,
      sellerIds: undefined,
    });
    expect(repository.findManagerUnitBusinessIds).not.toHaveBeenCalled();
    expect(report.filters).toMatchObject({ unit_business_id: "ub-21", seller_id: null, manager_id: null });
  });

  it("marca e produto viram a interseção de product_id, nos movimentos e nas linhas", async () => {
    await service.getReport({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      brands: ["Marca Y"],
      productIds: ["p2", "p3"],
    });
    expect(repository.findSaleMovementIds.mock.calls[0][3]).toEqual(["p2"]);
    expect(repository.findInvoicesWithoutMovement.mock.calls[0][3]).toEqual(["p2"]);
    expect(repository.findCommissionRows.mock.calls[0][1].productIds).toEqual(["p2"]);
  });

  it("gerente vira as lojas dele; pedido de outra loja não entra", async () => {
    repository.findManagerUnitBusinessIds.mockResolvedValue(["ub-9"]);
    await service.getReport({ startDate: "2026-10-01", endDate: "2026-10-31", managerIds: ["u1"], sellerIds: ["s1"] });

    expect(repository.findManagerUnitBusinessIds).toHaveBeenCalledWith(["u1"]);
    expect(repository.findCommissionRows).toHaveBeenCalledWith([], {
      productIds: undefined,
      sellerIds: ["s1"],
      unitBusinessIds: ["ub-9"],
    });
  });
});
