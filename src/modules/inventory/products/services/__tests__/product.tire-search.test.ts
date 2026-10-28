// Mocks com factory — o product.service puxa módulos que abrem Redis/BullMQ no import.
jest.mock("../../repository/product.repository", () => ({
  __esModule: true,
  ProductRepository: class {},
  default: { findTireCandidates: jest.fn() },
}));
jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));
jest.mock("../../../brands/brands.service", () => ({
  __esModule: true,
  default: { findSimilarBrand: jest.fn() },
}));
jest.mock("../../../../warehouse/expedition/batch/batch.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("../../../../warehouse/expedition/batch-items/batch-items.service", () => ({
  __esModule: true,
  default: { findPendingProductIds: jest.fn() },
}));
jest.mock("../../../supplier-mapping/supplier-mapping.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../product-config/product_config.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../../handlers/tecinco/queues/helpers/product.helpers", () => ({ __esModule: true }));
jest.mock("../../repository/product-with-movements", () => ({ __esModule: true, default: {} }));
jest.mock("../../../kit-components/kit-component.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../rims/rim.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../tire-measures/tire-measure.service", () => ({ __esModule: true, default: {} }));

import productService from "../product.service";
import productRepository from "../../repository/product.repository";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import brandsService from "../../../brands/brands.service";
import expeditionBatchService from "../../../../warehouse/expedition/batch/batch.service";
import expeditionBatchItemsService from "../../../../warehouse/expedition/batch-items/batch-items.service";
import { TireMatchProbability, TireSearchMode } from "../../product.types";

const UNIT_BUSINESS_ID = "ub-1";
const CAMSO_ID = "brand-camso";

// Linha devolvida pela repository (instância Sequelize com get({ plain })).
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  get: () => ({ id, name, brand_id: null, mapped_in_user_integration: false, ...extra }),
});

const names = (result: Awaited<ReturnType<typeof productService.searchTireCandidates>>) =>
  (result ?? []).map((c) => [c.product.name, c.probability]);

describe("ProductService.searchTireCandidates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (unitBusinessService.findById as jest.Mock).mockResolvedValue({ integrations_id: "int-1" });
    (brandsService.findSimilarBrand as jest.Mock).mockResolvedValue({ id: CAMSO_ID });
  });

  it("pontua por índice/marca e ordena ALTA → MEDIA (índice antes da marca) → IMPROVAVEL", async () => {
    (productRepository.findTireCandidates as jest.Mock).mockResolvedValue([
      row("1", "PNEU 12.5/80-18 R3 12PR SL TL PNEU CAMSO"),
      row("2", "PNEU 12.5/80-18 R4 12PR SL TL PNEU"),
      row("3", "PNEU 12.5/80-18 R4 R3 12PR SL TL PNEU CAMSO"),
      row("4", "PNEU 12.5/80-18 R1 12PR SL TL", { mapped_in_user_integration: true }),
      row("5", "PNEU 12.5/80-18 R4 12PR SL TL PNEU CAMSO"),
      row("6", "PNEU 12.5/80-18 R4 R3 12PR SL TL PNEU"),
    ]);

    const result = await productService.searchTireCandidates(
      { mode: TireSearchMode.NORMAL, measure: "12.5/80-18", loadIndex: "R4", brand: "CAMSO", expeditionBatchId: "ignored" },
      UNIT_BUSINESS_ID,
    );

    expect(names(result)).toEqual([
      ["PNEU 12.5/80-18 R4 12PR SL TL PNEU CAMSO", TireMatchProbability.HIGH],
      ["PNEU 12.5/80-18 R4 R3 12PR SL TL PNEU CAMSO", TireMatchProbability.HIGH],
      ["PNEU 12.5/80-18 R4 12PR SL TL PNEU", TireMatchProbability.MEDIUM],
      ["PNEU 12.5/80-18 R4 R3 12PR SL TL PNEU", TireMatchProbability.MEDIUM],
      ["PNEU 12.5/80-18 R3 12PR SL TL PNEU CAMSO", TireMatchProbability.MEDIUM],
      ["PNEU 12.5/80-18 R1 12PR SL TL", TireMatchProbability.UNLIKELY],
    ]);
    expect(result?.[0].score).toEqual({ matched: 2, total: 2 });
    expect(result?.[5].mapped_in_user_integration).toBe(true);
    expect(result?.[5].product).not.toHaveProperty("mapped_in_user_integration");
    // NORMAL ignora o lote e busca no catálogo todo.
    expect(expeditionBatchService.findOne).not.toHaveBeenCalled();
    expect((productRepository.findTireCandidates as jest.Mock).mock.calls[0][0].productIds).toBeUndefined();
  });

  it("marca bate pelo brand_id mesmo sem o texto no nome", async () => {
    (productRepository.findTireCandidates as jest.Mock).mockResolvedValue([
      row("1", "PNEU 12.5/80-18 R4 12PR", { brand_id: CAMSO_ID }),
    ]);

    const result = await productService.searchTireCandidates(
      { mode: TireSearchMode.NORMAL, measure: "12.5/80-18", brand: "CAMSO" },
      UNIT_BUSINESS_ID,
    );

    expect(result?.[0].matches).toEqual({ load_index: null, brand: true });
    expect(result?.[0].probability).toBe(TireMatchProbability.HIGH);
  });

  it("só com a medida: probability null e ordem por nome", async () => {
    (productRepository.findTireCandidates as jest.Mock).mockResolvedValue([
      row("2", "PNEU 12.5/80-18 R4 B"),
      row("1", "PNEU 12.5/80-18 R4 A"),
    ]);

    const result = await productService.searchTireCandidates(
      { mode: TireSearchMode.NORMAL, measure: "12.5/80-18" },
      UNIT_BUSINESS_ID,
    );

    expect(names(result)).toEqual([
      ["PNEU 12.5/80-18 R4 A", null],
      ["PNEU 12.5/80-18 R4 B", null],
    ]);
    expect(result?.[0].score).toEqual({ matched: 0, total: 0 });
    expect(brandsService.findSimilarBrand).not.toHaveBeenCalled();
  });

  it("IN_BATCH restringe aos itens do lote que faltam bipar", async () => {
    (expeditionBatchService.findOne as jest.Mock).mockResolvedValue({ id: "batch-1" });
    (expeditionBatchItemsService.findPendingProductIds as jest.Mock).mockResolvedValue(["p-1"]);
    (productRepository.findTireCandidates as jest.Mock).mockResolvedValue([]);

    await productService.searchTireCandidates(
      { mode: TireSearchMode.IN_BATCH, measure: "12.5/80-18", expeditionBatchId: "batch-1" },
      UNIT_BUSINESS_ID,
    );

    expect(expeditionBatchService.findOne).toHaveBeenCalledWith({
      where: { id: "batch-1", unit_business_id: UNIT_BUSINESS_ID },
      attributes: ["id"],
    });
    expect((productRepository.findTireCandidates as jest.Mock).mock.calls[0][0].productIds).toEqual(["p-1"]);
  });

  it("IN_BATCH sem item pendente devolve vazio sem buscar", async () => {
    (expeditionBatchService.findOne as jest.Mock).mockResolvedValue({ id: "batch-1" });
    (expeditionBatchItemsService.findPendingProductIds as jest.Mock).mockResolvedValue([]);

    const result = await productService.searchTireCandidates(
      { mode: TireSearchMode.IN_BATCH, measure: "12.5/80-18", expeditionBatchId: "batch-1" },
      UNIT_BUSINESS_ID,
    );

    expect(result).toEqual([]);
    expect(productRepository.findTireCandidates).not.toHaveBeenCalled();
  });

  it("IN_BATCH com lote de outra loja devolve null (404 no controller)", async () => {
    (expeditionBatchService.findOne as jest.Mock).mockResolvedValue(null);

    const result = await productService.searchTireCandidates(
      { mode: TireSearchMode.IN_BATCH, measure: "12.5/80-18", expeditionBatchId: "batch-x" },
      UNIT_BUSINESS_ID,
    );

    expect(result).toBeNull();
    expect(productRepository.findTireCandidates).not.toHaveBeenCalled();
  });
});
