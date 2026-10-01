import { ProductStockFlowService } from "../services/main/product-stock-flow/product-stock-flow.service";

jest.mock("../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  CD21_UNIT_BUSINESS_NUMBER: "21",
}));
jest.mock("../../../inventory/products/services/product.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock("../../../inventory/product-config/product_config.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

import unitBusinessService from "../../../company/unit-business/unit-business.service";
import productService from "../../../inventory/products/services/product.service";
import productConfigService from "../../../inventory/product-config/product_config.service";

describe("ProductStockFlowService", () => {
  const repository = {
    aggregateInputs: jest.fn(),
    aggregateOutputs: jest.fn(),
    aggregateReturns: jest.fn(),
  };
  const service = new ProductStockFlowService(repository as any);

  beforeEach(() => {
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({
      id: "ub-21",
      number: "21",
    });
    (productService.findAll as jest.Mock).mockResolvedValue([
      { id: "p1", name: "Pneu A" },
    ]);
    (productConfigService.findAll as jest.Mock).mockResolvedValue([
      { product_id: "p1", sku: "SKU-A" },
    ]);
    repository.aggregateInputs.mockResolvedValue([
      {
        month: "2026-05",
        product_id: "p1",
        total_input_quantity: "10.0000",
        total_input_value: "940.0000",
        inputs_without_net_amount: "0",
      },
    ]);
    repository.aggregateOutputs.mockResolvedValue([
      {
        month: "2026-05",
        product_id: "p1",
        total_output_quantity: "4.0000",
        total_output_value: "6800.00000000",
        outputs_without_price: "1",
      },
    ]);
    repository.aggregateReturns.mockResolvedValue([]);
  });

  it("filtra pela Loja 21 e limita o período ao dia inteiro no fuso de São Paulo", async () => {
    await service.getReport({ startDate: "2026-05-01", endDate: "2026-05-31" });

    const [ubId, start, end] = repository.aggregateInputs.mock.calls[0];
    expect(ubId).toBe("ub-21");
    expect(start.toISOString()).toBe("2026-05-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-01T02:59:59.999Z");
  });

  it("monta filtros, meses, consolidado, summary e warnings", async () => {
    const report = await service.getReport({
      startDate: "2026-05-01",
      endDate: "2026-06-30",
    });

    expect(report.filters).toEqual({
      store_id: 21,
      unit_business_id: "ub-21",
      start_date: "2026-05-01",
      end_date: "2026-06-30",
    });
    expect(report.months.map((m) => m.month)).toEqual(["2026-06", "2026-05"]);
    expect(report.months[1].products[0]).toMatchObject({
      product_name: "Pneu A",
      sku: "SKU-A",
      total_input_value: 940,
      total_output_value: 6800,
    });
    expect(report.consolidated).toHaveLength(1);
    expect(report.summary.total_output_quantity).toBe(4);
    expect(report.warnings.outputs_without_price).toBe(1);
  });

  it("devolução não entra nas entradas, tem colunas próprias e abate a saída", async () => {
    repository.aggregateReturns.mockResolvedValue([
      {
        month: "2026-05",
        product_id: "p1",
        total_return_quantity: "1.0000",
        total_return_value: "390.8300",
        returns_without_price: "0",
      },
    ]);

    const report = await service.getReport({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });

    expect(repository.aggregateReturns.mock.calls[0][0]).toBe("ub-21");
    expect(report.summary).toEqual({
      total_input_quantity: 10,
      total_output_quantity: 3,
      total_return_quantity: 1,
      total_input_value: 940,
      total_output_value: 6409.17,
      total_return_value: 390.83,
    });
  });

  it("não consulta produtos quando não há movimentação", async () => {
    repository.aggregateInputs.mockResolvedValue([]);
    repository.aggregateOutputs.mockResolvedValue([]);
    repository.aggregateReturns.mockResolvedValue([]);

    const report = await service.getReport({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });

    expect(productService.findAll).not.toHaveBeenCalled();
    expect(report.consolidated).toEqual([]);
  });

  it("falha quando a Loja 21 não está cadastrada", async () => {
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      service.getReport({ startDate: "2026-05-01", endDate: "2026-05-31" }),
    ).rejects.toThrow("Loja 21");
  });
});
