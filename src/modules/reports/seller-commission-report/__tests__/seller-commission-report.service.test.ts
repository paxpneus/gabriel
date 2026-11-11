// Fachada da invoice carrega todos os services (Redis/BullMQ); aqui só os helpers SQL puros são usados, reais.
jest.mock("../../../warehouse/fiscal/invoices/invoice", () => ({
  __esModule: true,
  ...jest.requireActual("../../../warehouse/fiscal/invoices/invoice/shared/helpers/totals"),
  ...jest.requireActual("../../../warehouse/fiscal/invoices/invoice/shared/helpers/custom-filters"),
  ...jest.requireActual("../../../warehouse/fiscal/invoices/invoice/shared/helpers/nfe-ide"),
}));

import { SellerCommissionReportService } from "../services/main/seller-commission-report/seller-commission-report.service";
import productService from "../../../inventory/products/services/product.service";

// Fachada de contacts carrega sellers.service (cadeia que abre Redis/BullMQ e não deixa o Jest sair); aqui só o SQL dos gerentes.
jest.mock("../../../sales/contacts", () => ({
  __esModule: true,
  storeManagersFromSql: jest.fn(() => ""),
  regionalManagersFromSql: jest.fn(() => ""),
}));

jest.mock("../../../inventory/products/services/product.service", () => ({
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

    const filters = { startDate: "2026-10-01", endDate: "2026-10-31", productIds: undefined, sellerIds: ["s1"], managerIds: undefined, unitBusinessIds: undefined, originUnitBusinessIds: undefined };
    expect(repository.findCommissionRows).toHaveBeenCalledWith(filters);
    expect(repository.countOrderWarnings).toHaveBeenCalledWith(filters);
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

  it("gerente vai pro repository como managerIds (loja/regional e vigência resolvidas no SQL), junto com o filtro de loja", async () => {
    await service.getReport({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      managerIds: ["c1"],
      unitBusinessIds: ["ub-1"],
    });

    expect(repository.findCommissionRows.mock.calls[0][0]).toMatchObject({ managerIds: ["c1"], unitBusinessIds: ["ub-1"] });
    expect(repository.countOrderWarnings.mock.calls[0][0]).toMatchObject({ managerIds: ["c1"], unitBusinessIds: ["ub-1"] });
  });
});
