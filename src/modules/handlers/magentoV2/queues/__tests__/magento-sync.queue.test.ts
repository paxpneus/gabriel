import { Job } from "bullmq";

// ─── Mocks de infraestrutura (Redis/BullMQ) — MagentoSyncQueue extends
// BaseQueueService, que cria Queue/QueueEvents reais no construtor mesmo com
// workless:true. Nenhum teste desta suite deve abrir conexão real com Redis. ──

jest.mock("../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    zrange: jest.fn(),
    exists: jest.fn(),
    scan: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

jest.mock(
  "../../../../../shared/providers/mail-provider/nodemailer.alert",
  () => ({
    __esModule: true,
    alertService: { sendAlert: jest.fn() },
  }),
);

const mockTransaction = {} as any;
jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb(mockTransaction)) },
}));

jest.mock("../../../../inventory/products/services/product.service", () => ({
  __esModule: true,
  default: { findById: jest.fn(), findAll: jest.fn() },
}));

jest.mock(
  "../../../../inventory/product-config/product_config.service",
  () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), bulkUpdate: jest.fn() },
  }),
);

jest.mock(
  "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service",
  () => ({
    __esModule: true,
    default: { upsertByFind: jest.fn() },
  }),
);

jest.mock(
  "../../../../integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: {
      createOrUpdateIntegrationMapping: jest.fn(),
      findExternalIdsMap: jest.fn(),
    },
  }),
);

jest.mock("../../api/magentoV2_api", () => ({
  __esModule: true,
  getMagentoIntegration: jest.fn(),
}));

jest.mock("../../service/catalog/products/products.service", () => ({
  __esModule: true,
  default: {
    obterProduto: jest.fn(),
    atualizarCustomAttribute: jest.fn(),
    buscarProdutosPorNome: jest.fn(),
    buscarProdutoPorId: jest.fn(),
  },
}));

import productService from "../../../../inventory/products/services/product.service";
import productConfigService from "../../../../inventory/product-config/product_config.service";
import unmappedInvoiceProductService from "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import integrationMappingService from "../../../../integrations/integration-mapping/integration-mapping.service";
import { getMagentoIntegration } from "../../api/magentoV2_api";
import magentoCatalogService from "../../service/catalog/products/products.service";

const UNIT_BUSINESS_ID = "ub-bling-1";
const MAGENTO_INTEGRATION_ID = "magento-integration-1";

// BLING_UNIT_BUSINESS_ID é lido pra uma const de módulo em magento-sync.queue.ts
// — precisa estar no env ANTES do import, senão o módulo captura undefined.
process.env.BLING_UNIT_BUSINESS_ID = UNIT_BUSINESS_ID;

import { MagentoSyncQueue } from "../magento-sync.queue";

function runSyncProduct(queue: MagentoSyncQueue, productId: string) {
  return queue.process({
    data: { kind: "sync-product", productId },
  } as unknown as Job<any>);
}

function runSyncAll(queue: MagentoSyncQueue) {
  return queue.process({ data: { kind: "sync-all" } } as unknown as Job<any>);
}

describe("MagentoSyncQueue", () => {
  let queue: MagentoSyncQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BLING_UNIT_BUSINESS_ID = UNIT_BUSINESS_ID;

    queue = new MagentoSyncQueue({ workless: true });

    (getMagentoIntegration as jest.Mock).mockResolvedValue({
      id: MAGENTO_INTEGRATION_ID,
    });
    (integrationMappingService.findExternalIdsMap as jest.Mock).mockResolvedValue(
      new Map(),
    );
    (
      integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock
    ).mockResolvedValue(undefined);
    (productConfigService.bulkUpdate as jest.Mock).mockResolvedValue([1]);
    (unmappedInvoiceProductService.upsertByFind as jest.Mock).mockResolvedValue(
      undefined,
    );
    (magentoCatalogService.atualizarCustomAttribute as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  describe("sync-product", () => {
    it("produto KIT: nunca sincroniza com o Magento", async () => {
      (productService.findById as jest.Mock).mockResolvedValue({
        id: "kit-1",
        name: "Kit X",
        type: "KIT",
      });

      await runSyncProduct(queue, "kit-1");

      expect(productConfigService.findOne).not.toHaveBeenCalled();
      expect(getMagentoIntegration).not.toHaveBeenCalled();
    });

    it("produto não encontrado localmente: ignora sem lançar", async () => {
      (productService.findById as jest.Mock).mockResolvedValue(null);

      await expect(runSyncProduct(queue, "missing-1")).resolves.toBeUndefined();
      expect(getMagentoIntegration).not.toHaveBeenCalled();
    });

    it("produto sem ProductConfig/SKU na unit business da Bling: ignora", async () => {
      (productService.findById as jest.Mock).mockResolvedValue({
        id: "p1",
        name: "Produto sem sku",
        type: "UNIT",
      });
      (productConfigService.findOne as jest.Mock).mockResolvedValue(null);

      await runSyncProduct(queue, "p1");

      expect(getMagentoIntegration).not.toHaveBeenCalled();
      expect(productConfigService.bulkUpdate).not.toHaveBeenCalled();
    });

    it("já mapeado (external_id = entity_id do Magento): busca por id, atualiza preço e custo_medio", async () => {
      (productService.findById as jest.Mock).mockResolvedValue({
        id: "p1",
        name: "Pneu Aro 14 Continental",
        type: "UNIT",
      });
      (productConfigService.findOne as jest.Mock)
        .mockResolvedValueOnce({
          product_id: "p1",
          unit_business_id: UNIT_BUSINESS_ID,
          sku: "10026681",
          gtin: "7890000000001",
          price: 400,
          average_cost: 250,
        })
        .mockResolvedValueOnce({ average_cost: 250 });
      (integrationMappingService.findExternalIdsMap as jest.Mock).mockResolvedValue(
        new Map([["p1", "751"]]),
      );
      (magentoCatalogService.buscarProdutoPorId as jest.Mock).mockResolvedValue({
        items: [{ id: 751, sku: "MAGENTO-SKU-ATUAL", price: 480 }],
      });

      await runSyncProduct(queue, "p1");

      expect(magentoCatalogService.buscarProdutoPorId).toHaveBeenCalledWith("751");
      expect(magentoCatalogService.obterProduto).not.toHaveBeenCalled();
      expect(productConfigService.bulkUpdate).toHaveBeenCalledWith(
        { price: 480 },
        expect.objectContaining({
          where: { product_id: "p1", unit_business_id: UNIT_BUSINESS_ID },
        }),
      );
      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: "PRODUCT",
          internal_id: "p1",
          external_id: "751",
        }),
        mockTransaction,
      );
      expect(magentoCatalogService.atualizarCustomAttribute).toHaveBeenCalledWith(
        "MAGENTO-SKU-ATUAL",
        "custo_medio",
        "250.00",
      );
    });

    it("sem mapping ainda: acha por SKU e mapeia (sem cair pro fallback por nome)", async () => {
      (productService.findById as jest.Mock).mockResolvedValue({
        id: "p2",
        name: "Pneu Aro 15",
        type: "UNIT",
      });
      (productConfigService.findOne as jest.Mock)
        .mockResolvedValueOnce({
          product_id: "p2",
          unit_business_id: UNIT_BUSINESS_ID,
          sku: "10099999",
          gtin: null,
          price: 300,
          average_cost: null,
        })
        .mockResolvedValueOnce({ average_cost: null });
      (magentoCatalogService.obterProduto as jest.Mock).mockResolvedValue({
        id: 900,
        sku: "10099999",
        price: 310,
      });

      await runSyncProduct(queue, "p2");

      expect(magentoCatalogService.obterProduto).toHaveBeenCalledWith("10099999");
      expect(magentoCatalogService.buscarProdutosPorNome).not.toHaveBeenCalled();
      // Ainda sem mapping (primeira sincronização): preço é escrito a partir
      // do valor encontrado no Magento.
      expect(productConfigService.bulkUpdate).toHaveBeenCalledWith(
        { price: 310 },
        expect.objectContaining({
          where: { product_id: "p2", unit_business_id: UNIT_BUSINESS_ID },
        }),
      );
      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ external_id: "900" }),
        mockTransaction,
      );
      // Sem average_cost: não tenta empurrar custo_medio.
      expect(magentoCatalogService.atualizarCustomAttribute).not.toHaveBeenCalled();
    });

    it("SKU não encontrado (404) e nome bate exatamente com 1 resultado: mapeia pelo fallback de nome", async () => {
      (productService.findById as jest.Mock).mockResolvedValue({
        id: "p3",
        name: "Pneu Aro 14 Continental",
        type: "UNIT",
      });
      (productConfigService.findOne as jest.Mock)
        .mockResolvedValueOnce({
          product_id: "p3",
          unit_business_id: UNIT_BUSINESS_ID,
          sku: "10026681",
          gtin: null,
          price: 300,
          average_cost: null,
        })
        .mockResolvedValueOnce({ average_cost: null });
      (magentoCatalogService.obterProduto as jest.Mock).mockRejectedValue({
        response: { status: 404 },
      });
      (magentoCatalogService.buscarProdutosPorNome as jest.Mock).mockResolvedValue({
        items: [{ id: 751, sku: "MAGENTO-SKU-1", name: "Pneu Aro 14 Continental" }],
      });

      await runSyncProduct(queue, "p3");

      expect(magentoCatalogService.buscarProdutosPorNome).toHaveBeenCalledWith(
        "Pneu Aro 14 Continental",
      );
      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ external_id: "751" }),
        mockTransaction,
      );
      expect(unmappedInvoiceProductService.upsertByFind).not.toHaveBeenCalled();
    });

    it("SKU não encontrado e nome ambíguo (mais de 1 resultado): não mapeia, registra unmapped", async () => {
      (productService.findById as jest.Mock).mockResolvedValue({
        id: "p4",
        name: "Pneu Aro 14 Continental",
        type: "UNIT",
      });
      (productConfigService.findOne as jest.Mock)
        .mockResolvedValueOnce({
          product_id: "p4",
          unit_business_id: UNIT_BUSINESS_ID,
          sku: "10026681",
          gtin: "7890000000001",
          price: 300,
          average_cost: null,
        })
        .mockResolvedValueOnce({ average_cost: null });
      (magentoCatalogService.obterProduto as jest.Mock).mockRejectedValue({
        response: { status: 404 },
      });
      (magentoCatalogService.buscarProdutosPorNome as jest.Mock).mockResolvedValue({
        items: [
          { sku: "MAGENTO-SKU-1", name: "Pneu Aro 14 Continental" },
          { sku: "MAGENTO-SKU-2", name: "Pneu Aro 14 Continental" },
        ],
      });

      await runSyncProduct(queue, "p4");

      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).not.toHaveBeenCalled();
      expect(unmappedInvoiceProductService.upsertByFind).toHaveBeenCalledWith(
        expect.objectContaining({
          invoice_id: null,
          integrations_id: MAGENTO_INTEGRATION_ID,
        }),
        expect.objectContaining({ type: "ERROR_INTEGRATION" }),
        expect.objectContaining({
          sku: "10026681",
          reason: "Produto não encontrado no Magento",
          status: "UNMAPPED",
          type: "ERROR_INTEGRATION",
        }),
        { transaction: mockTransaction },
      );
    });

    it("custo_medio: 404 no Magento não derruba o job (best effort)", async () => {
      (productService.findById as jest.Mock).mockResolvedValue({
        id: "p5",
        name: "Produto qualquer",
        type: "UNIT",
      });
      (productConfigService.findOne as jest.Mock)
        .mockResolvedValueOnce({
          product_id: "p5",
          unit_business_id: UNIT_BUSINESS_ID,
          sku: "sku-5",
          gtin: null,
          price: 100,
          average_cost: 80,
        })
        .mockResolvedValueOnce({ average_cost: 80 });
      (integrationMappingService.findExternalIdsMap as jest.Mock).mockResolvedValue(
        new Map([["p5", "800"]]),
      );
      (magentoCatalogService.buscarProdutoPorId as jest.Mock)
        .mockResolvedValueOnce({ items: [{ id: 800, sku: "sku-5", price: 100 }] })
        .mockRejectedValueOnce({ response: { status: 404 } });

      await expect(runSyncProduct(queue, "p5")).resolves.toBeUndefined();
      expect(magentoCatalogService.atualizarCustomAttribute).not.toHaveBeenCalled();
    });
  });

  describe("sync-all", () => {
    it("enfileira um sync-product por produto UNIT com SKU na unit business da Bling", async () => {
      (productConfigService.findAll as jest.Mock).mockResolvedValue([
        { product_id: "p1" },
        { product_id: "p2" },
      ]);
      (productService.findAll as jest.Mock).mockResolvedValue([
        { id: "p1" },
        { id: "p2" },
      ]);
      const addSpy = jest.spyOn(queue, "add").mockResolvedValue(undefined as any);

      await runSyncAll(queue);

      expect(productConfigService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ unit_business_id: UNIT_BUSINESS_ID }),
        }),
      );
      expect(addSpy).toHaveBeenCalledWith(
        { kind: "sync-product", productId: "p1" },
        "magento-sync-product-p1",
      );
      expect(addSpy).toHaveBeenCalledWith(
        { kind: "sync-product", productId: "p2" },
        "magento-sync-product-p2",
      );
      expect(addSpy).toHaveBeenCalledTimes(2);
    });

    it("nenhum produto configurado: não enfileira nada", async () => {
      (productConfigService.findAll as jest.Mock).mockResolvedValue([]);
      const addSpy = jest.spyOn(queue, "add").mockResolvedValue(undefined as any);

      await runSyncAll(queue);

      expect(productService.findAll).not.toHaveBeenCalled();
      expect(addSpy).not.toHaveBeenCalled();
    });
  });
});
