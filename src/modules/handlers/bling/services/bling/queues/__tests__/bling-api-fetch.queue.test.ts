import { Job } from "bullmq";

// ─── Mocks de infraestrutura (Redis/BullMQ) — BlingApiFetchQueue extends
// BaseQueueService, que cria Queue/QueueEvents reais no construtor mesmo com
// workless:true. Nenhum teste desta suite deve abrir conexão real com Redis. ──

jest.mock("../../../../../../../config/redis", () => ({
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
}));

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../api/bling_api.service", () => ({
  __esModule: true,
  blingApi: { get: jest.fn() },
  getBlingIntegration: jest.fn(),
}));

jest.mock(
  "../../../../../../../shared/providers/mail-provider/nodemailer.alert",
  () => ({
    __esModule: true,
    alertService: { sendAlert: jest.fn() },
  }),
);

jest.mock(
  "../../../../../magentoV2/service/catalog/products/products.service",
  () => ({
    __esModule: true,
    default: { obterProduto: jest.fn(), atualizarCustomAttribute: jest.fn() },
  }),
);

jest.mock("../../../../../../inventory/brands/brands.service", () => ({
  __esModule: true,
  default: { findSimilarBrand: jest.fn() },
}));

jest.mock("../../../../../tecinco/queues/helpers/product.helpers", () => ({
  __esModule: true,
  resolveProductWithMapping: jest.fn(),
  assertEanNotOwnedByAnotherProduct: jest.fn().mockResolvedValue(undefined),
  EanConflictError: class EanConflictError extends Error {},
}));

jest.mock(
  "../../../../../../integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: {
      createOrUpdateIntegrationMapping: jest.fn(),
      findExternalIdsMap: jest.fn(),
    },
  }),
);

jest.mock("../../../../../magentoV2/api/magentoV2_api", () => ({
  __esModule: true,
  getMagentoIntegration: jest.fn(),
}));

jest.mock(
  "../../../../../../inventory/stock/stock-movements/stock-movements.service",
  () => ({
    __esModule: true,
    default: { syncProductStockMovements: jest.fn() },
  }),
);

jest.mock(
  "../../../../../../inventory/products/services/product.service",
  () => ({
    __esModule: true,
    default: { upsertWithComponents: jest.fn() },
  }),
);

const mockTransaction = {} as any;
jest.mock("../../../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb(mockTransaction)) },
}));

import { blingApi, getBlingIntegration } from "../../../../api/bling_api.service";
import { resolveProductWithMapping } from "../../../../../tecinco/queues/helpers/product.helpers";
import brandsService from "../../../../../../inventory/brands/brands.service";
import integrationMappingService from "../../../../../../integrations/integration-mapping/integration-mapping.service";
import { getMagentoIntegration } from "../../../../../magentoV2/api/magentoV2_api";
import magentoCatalogService from "../../../../../magentoV2/service/catalog/products/products.service";
import stockMovementsService from "../../../../../../inventory/stock/stock-movements/stock-movements.service";
import productService from "../../../../../../inventory/products/services/product.service";
import Product from "../../../../../../inventory/products/product.model";
import ProductConfig from "../../../../../../inventory/product-config/product_config.model";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";
import Group from "../../../../../../inventory/groups/group/group.model";
import Subgroup from "../../../../../../inventory/groups/subgroup/subgroup.model";
import InventoryBatch from "../../../../../../inventory/stock-inventory/inventory-batch/inventory-batch.model";
import UnmappedInvoiceProduct from "../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import { BlingApiFetchQueue } from "../bling-api-fetch.queue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INTEGRATION_ID = "integration-1";
const UNIT_BUSINESS_ID = "ub-bling-1";

function makeBlingProduct(overrides: Partial<any> = {}): any {
  return {
    id: 90001,
    nome: "Pneu Aro 14 Continental",
    codigo: "10026681",
    gtin: "7890000000001",
    preco: 500,
    precoCusto: 300,
    precoCompra: 280,
    formato: "S",
    unidade: "UN",
    marca: "Continental",
    estoque: { saldoVirtualTotal: 10 },
    fornecedor: { precoCusto: 300, precoCompra: 280 },
    tributacao: {},
    ...overrides,
  };
}

function makeKitBlingProduct(overrides: Partial<any> = {}): any {
  return makeBlingProduct({
    id: 90002,
    codigo: "10026681K2",
    formato: "E",
    estrutura: {
      componentes: [{ produto: { id: 555 }, quantidade: 2 }],
    },
    ...overrides,
  });
}

function makeFakeBlingApi(params: {
  blingId: number;
  blingProduct: any;
  componentBlingId?: number;
  componentBlingProduct?: any;
}) {
  const get = jest.fn().mockImplementation((url: string) => {
    if (url === `/produtos/${params.blingId}`) {
      return Promise.resolve({ data: { data: params.blingProduct } });
    }
    if (
      params.componentBlingId &&
      url === `/produtos/${params.componentBlingId}`
    ) {
      return Promise.resolve({
        data: { data: params.componentBlingProduct ?? {} },
      });
    }
    if (url.startsWith("/estoques/saldos")) {
      return Promise.resolve({
        data: {
          data: [
            {
              produto: { id: params.blingId },
              saldoFisicoTotal: 5,
            },
          ],
        },
      });
    }
    return Promise.resolve({ data: { data: {} } });
  });

  (blingApi as any).get = get;
  return get;
}

function makeUpsertedProduct(overrides: Partial<any> = {}) {
  return { id: "upserted-product-id", ...overrides };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("BlingApiFetchQueue.fetchAndUpsertProduct", () => {
  let queue: BlingApiFetchQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.BLING_UNIT_BUSINESS_ID = UNIT_BUSINESS_ID;

    queue = new BlingApiFetchQueue({ workless: true });

    (getBlingIntegration as jest.Mock).mockResolvedValue({
      id: INTEGRATION_ID,
    });
    (UnitBusiness.findByPk as jest.Mock).mockResolvedValue({
      id: UNIT_BUSINESS_ID,
    });
    (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
    (brandsService.findSimilarBrand as jest.Mock).mockResolvedValue(null);
    (Group.findOne as jest.Mock).mockResolvedValue({
      id: "group-1",
      name: "PNEUS",
    });
    (Subgroup.findOne as jest.Mock).mockResolvedValue({
      id: "subgroup-1",
      name: "DIVERSOS",
    });
    (getMagentoIntegration as jest.Mock).mockResolvedValue({
      id: "magento-1",
    });
    (magentoCatalogService.obterProduto as jest.Mock).mockResolvedValue(null);
    (integrationMappingService.findExternalIdsMap as jest.Mock).mockResolvedValue(
      new Map(),
    );
    (
      integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock
    ).mockResolvedValue(undefined);
    (stockMovementsService.syncProductStockMovements as jest.Mock).mockResolvedValue(
      { average_cost: 100, created: 1 },
    );
    (InventoryBatch.findAll as jest.Mock).mockResolvedValue([]);
    (productService.upsertWithComponents as jest.Mock).mockResolvedValue(
      makeUpsertedProduct(),
    );
    (Product.findOne as jest.Mock).mockResolvedValue(null);
    (ProductConfig.findOne as jest.Mock).mockResolvedValue(null);
    (UnmappedInvoiceProduct.findOne as jest.Mock).mockResolvedValue(null);
    (UnmappedInvoiceProduct.create as jest.Mock).mockResolvedValue(undefined);
  });

  function runProductJob(blingProduct: any) {
    return queue.process({
      data: {
        eventId: "evt-1",
        resource: "product",
        action: "updated",
        apiFetch: { blingId: blingProduct.id },
      },
    } as unknown as Job<any>);
  }

  // ── produto simples (não KIT) ────────────────────────────────────────────

  describe("produto simples (não KIT)", () => {
    it("produto sem mapping (novo, precisa de revisão manual): não cria produto, registra em unmapped_invoice_products", async () => {
      const blingProduct = makeBlingProduct();
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);

      await runProductJob(blingProduct);

      expect(UnmappedInvoiceProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invoice_id: null,
          sku: blingProduct.codigo,
          ean: blingProduct.gtin,
          product_name: blingProduct.nome,
          reason: "Produto novo, precisa de mapeamento manual",
          status: "UNMAPPED",
        }),
      );
      expect(productService.upsertWithComponents).not.toHaveBeenCalled();
      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).not.toHaveBeenCalled();
    });

    it("já registrado como unmapped — não duplica a linha", async () => {
      const blingProduct = makeBlingProduct();
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
      (UnmappedInvoiceProduct.findOne as jest.Mock).mockResolvedValue({
        id: "existing-unmapped-id",
      });

      await runProductJob(blingProduct);

      expect(UnmappedInvoiceProduct.create).not.toHaveBeenCalled();
    });

    it("produto já existente (mapeado): atualiza (não cria de novo) e não duplica o integration mapping", async () => {
      const blingProduct = makeBlingProduct();
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue({
        id: "existing-product-id",
      });
      (productService.upsertWithComponents as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "existing-product-id" }),
      );

      await runProductJob(blingProduct);

      expect(productService.upsertWithComponents).toHaveBeenCalledTimes(1);
      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({ id: "existing-product-id" }),
      );
      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).not.toHaveBeenCalled();
    });
  });

  // ── composição de KIT ────────────────────────────────────────────────────

  describe("composição de KIT", () => {
    // Esses testes cobrem a sincronização de kit_components, não a resolução
    // do KIT em si — precisam que o KIT já esteja mapeado (senão o fluxo para
    // no registro em unmapped_invoice_products antes de chegar no upsert).
    beforeEach(() => {
      (resolveProductWithMapping as jest.Mock).mockResolvedValue({
        id: "existing-kit-product-id",
      });
    });

    it("KIT sem produto de componente informado (produto sem id): não sincroniza kit_components, mantém o código original", async () => {
      const blingProduct = makeKitBlingProduct({
        estrutura: { componentes: [] },
      });
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });

      await runProductJob(blingProduct);

      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({ components: undefined }),
      );
      const configUpsertCall = (ProductConfig.upsert as jest.Mock).mock
        .calls[0][0];
      expect(configUpsertCall.sku).toBe(blingProduct.codigo);
    });

    it("componente do KIT ainda não existe localmente (produto do kit sem id): não sincroniza kit_components", async () => {
      const blingProduct = makeKitBlingProduct();
      const componentBlingId = blingProduct.estrutura.componentes[0].produto.id;
      makeFakeBlingApi({
        blingId: blingProduct.id,
        blingProduct,
        componentBlingId,
        componentBlingProduct: { codigo: "10026681" },
      });
      // Componente não tem Product local — só resolve via fallback da API.
      (Product.findOne as jest.Mock).mockResolvedValue(null);

      await runProductJob(blingProduct);

      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({ components: undefined }),
      );
      // O SKU sintético ainda é montado a partir do sku resolvido via fallback.
      const configUpsertCall = (ProductConfig.upsert as jest.Mock).mock
        .calls[0][0];
      expect(configUpsertCall.sku).toBe("10026681K2");
    });

    it("componente existe localmente mas o SKU do sistema não bate com o da Bling: ainda assim sincroniza kit_components pelo product_id", async () => {
      const blingProduct = makeKitBlingProduct();
      const componentBlingId = blingProduct.estrutura.componentes[0].produto.id;
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });

      (Product.findOne as jest.Mock).mockResolvedValue({
        id: "local-component-product-id",
      });
      // ProductConfig do componente não existe pra essa unit_business — sku
      // do sistema não bate (não resolve) com o que a Bling espera.
      (ProductConfig.findOne as jest.Mock).mockResolvedValue(null);

      await runProductJob(blingProduct);

      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({
          components: [
            { product_component_id: "local-component-product-id", quantity: 2 },
          ],
        }),
      );
      // Sem SKU do componente resolvido -> mantém o código original da Bling.
      const configUpsertCall = (ProductConfig.upsert as jest.Mock).mock
        .calls[0][0];
      expect(configUpsertCall.sku).toBe(blingProduct.codigo);
    });

    it("KIT refletindo corretamente no banco: sincroniza kit_components com o product_id e quantidade certos, e monta o SKU sintético", async () => {
      const blingProduct = makeKitBlingProduct();
      const componentBlingId = blingProduct.estrutura.componentes[0].produto.id;
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });

      (Product.findOne as jest.Mock).mockResolvedValue({
        id: "local-component-product-id",
      });
      (ProductConfig.findOne as jest.Mock).mockResolvedValue({
        sku: "10026681",
      });
      (productService.upsertWithComponents as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "kit-product-id" }),
      );

      await runProductJob(blingProduct);

      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({
          values: expect.objectContaining({ type: "KIT" }),
          components: [
            { product_component_id: "local-component-product-id", quantity: 2 },
          ],
        }),
      );

      const configUpsertCall = (ProductConfig.upsert as jest.Mock).mock
        .calls[0][0];
      expect(configUpsertCall.product_id).toBe("kit-product-id");
      expect(configUpsertCall.sku).toBe("10026681K2");
      expect(configUpsertCall.unit_business_id).toBe(UNIT_BUSINESS_ID);
    });
  });
});
