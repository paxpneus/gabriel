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
  isProductOwnedByIntegration: jest.fn(
    (product: { integrations_id?: string | null }, integrationsId: string) =>
      !product?.integrations_id || product.integrations_id === integrationsId,
  ),
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
    default: { upsertWithComponents: jest.fn(), create: jest.fn() },
  }),
);

jest.mock(
  "../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service",
  () => ({
    __esModule: true,
    default: { resolveFromCreatedProduct: jest.fn() },
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
import unmappedInvoiceProductService from "../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
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
    (productService.create as jest.Mock).mockResolvedValue(
      makeUpsertedProduct({ id: "created-product-id" }),
    );
    (
      unmappedInvoiceProductService.resolveFromCreatedProduct as jest.Mock
    ).mockResolvedValue(undefined);
  });

  function runProductJob(blingProduct: any, apiFetchOverrides: Partial<any> = {}) {
    return queue.process({
      data: {
        eventId: "evt-1",
        resource: "product",
        action: "updated",
        apiFetch: { blingId: blingProduct.id, ...apiFetchOverrides },
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

    it("já registrado como unmapped — não duplica a linha, mas atualiza (upsert) o registro existente com os dados mais recentes", async () => {
      const blingProduct = makeBlingProduct();
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
      const existingUnmapped = { id: "existing-unmapped-id", update: jest.fn() };
      (UnmappedInvoiceProduct.findOne as jest.Mock).mockResolvedValue(
        existingUnmapped,
      );

      await runProductJob(blingProduct);

      expect(UnmappedInvoiceProduct.create).not.toHaveBeenCalled();
      expect(existingUnmapped.update).toHaveBeenCalledWith(
        expect.objectContaining({
          external_id: String(blingProduct.id),
          product_name: blingProduct.nome,
        }),
      );
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

  // ── criação manual a partir de unmapped (create:true) ────────────────────
  // Disparado só pelo endpoint POST .../create-product — nunca pelo fluxo
  // normal de webhook/sync (ver testes acima, que continuam sem passar
  // create:true e devem preservar o comportamento de sempre).

  describe("criação manual a partir de unmapped (opts.create:true)", () => {
    it("sem mapping + create:true: cria Product+ProductConfig+IntegrationMapping, resolve o unmapped de origem, e CAI pro resto do fluxo (não retorna cedo)", async () => {
      const blingProduct = makeBlingProduct();
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
      (productService.create as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "created-product-id" }),
      );
      (productService.upsertWithComponents as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "created-product-id" }),
      );

      await runProductJob(blingProduct, { create: true });

      // Não registra o produto de novo como unmapped por falta de mapping
      // (o registro de unmapped do Magento, por falta de SKU lá, é outra
      // coisa e não é o que este teste cobre).
      expect(UnmappedInvoiceProduct.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "Produto novo, precisa de mapeamento manual",
        }),
      );

      expect(productService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: blingProduct.nome,
          id_system: String(blingProduct.id),
          integrations_id: INTEGRATION_ID,
          config: expect.objectContaining({
            unit_business_id: UNIT_BUSINESS_ID,
            sku: blingProduct.codigo,
            gtin: blingProduct.gtin,
            price: blingProduct.preco,
          }),
        }),
      );

      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: "PRODUCT",
          internal_id: "created-product-id",
          integrations_id: INTEGRATION_ID,
          external_id: String(blingProduct.id),
        }),
      );

      expect(
        unmappedInvoiceProductService.resolveFromCreatedProduct,
      ).toHaveBeenCalledWith({
        externalId: String(blingProduct.id),
        integrationsId: INTEGRATION_ID,
      });

      // Cai pro resto do fluxo normal (fall-through) — não retorna cedo.
      // O produto recém-criado é "próprio" (mesma integração), então o
      // fall-through completa os campos descritivos (brand/subgroup/measure)
      // via upsertWithComponents, igual faria pra um produto já existente.
      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({ id: "created-product-id" }),
      );
      expect(ProductConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ product_id: "created-product-id" }),
        expect.anything(),
      );
      expect(stockMovementsService.syncProductStockMovements).toHaveBeenCalledWith(
        "created-product-id",
        UNIT_BUSINESS_ID,
        undefined,
        expect.anything(),
      );
    });

    it("dados faltando no ERP (sem gtin e sem preço): cria o produto mesmo assim, sem gtin e com preço 0 (nunca NaN)", async () => {
      const blingProduct = makeBlingProduct({ gtin: undefined, preco: undefined });
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
      (productService.create as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "created-product-id" }),
      );

      await runProductJob(blingProduct, { create: true });

      expect(productService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ gtin: undefined, price: 0 }),
        }),
      );
      const price = (productService.create as jest.Mock).mock.calls[0][0].config
        .price;
      expect(Number.isNaN(price)).toBe(false);
      // Sem EAN, o resto do fluxo não deveria quebrar tentando validar
      // conflito com um valor undefined.
      expect(ProductConfig.upsert).toHaveBeenCalled();
    });

    it("código já existente em outro produto: productService.create rejeita (EanConflictError) e o fluxo aborta sem criar mapping nem resolver o unmapped", async () => {
      const blingProduct = makeBlingProduct();
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
      (productService.create as jest.Mock).mockRejectedValue(
        new Error(
          `gtin ${blingProduct.gtin} já pertence a outro produto nessa unit_business`,
        ),
      );

      await expect(
        runProductJob(blingProduct, { create: true }),
      ).rejects.toThrow(/já pertence a outro produto/);

      expect(
        integrationMappingService.createOrUpdateIntegrationMapping,
      ).not.toHaveBeenCalled();
      expect(
        unmappedInvoiceProductService.resolveFromCreatedProduct,
      ).not.toHaveBeenCalled();
      expect(ProductConfig.upsert).not.toHaveBeenCalled();
    });

    it("opts.create ausente (comportamento padrão, ex.: sync normal): mesmo sem mapping, NÃO cria produto — continua só registrando unmapped", async () => {
      const blingProduct = makeBlingProduct();
      makeFakeBlingApi({ blingId: blingProduct.id, blingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);

      await runProductJob(blingProduct); // sem create:true

      expect(productService.create).not.toHaveBeenCalled();
      expect(UnmappedInvoiceProduct.create).toHaveBeenCalled();
    });

    it("KIT sem mapping, SEM create:true: cria automaticamente mesmo assim — código de KIT é sintético (componente+quantidade), nunca ambíguo, não precisa de confirmação manual", async () => {
      const kitBlingProduct = makeKitBlingProduct();
      makeFakeBlingApi({ blingId: kitBlingProduct.id, blingProduct: kitBlingProduct });
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
      (productService.create as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "created-kit-product-id" }),
      );
      (productService.upsertWithComponents as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "created-kit-product-id" }),
      );

      await runProductJob(kitBlingProduct); // sem create:true

      expect(UnmappedInvoiceProduct.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "Produto novo, precisa de mapeamento manual",
        }),
      );
      expect(productService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "KIT",
          id_system: String(kitBlingProduct.id),
        }),
      );
      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "created-kit-product-id",
          values: expect.objectContaining({ type: "KIT" }),
        }),
      );
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

// ─── findBlingInvoiceIdByChave / upsertInvoiceFromXml ──────────────────────────
// A resolução de itens de uma nota importada por XML NUNCA usa o próprio XML —
// o XML só serve pra descobrir a nota dentro da Bling (por chave de acesso);
// a partir daí tudo delega pra fetchAndUpsertInvoice, que resolve os itens por
// nf.itens[].codigo (testado à parte, não duplicado aqui).

const CHAVE = "29260802036483000614550010004404561245674661";

function buildMinimalNfeXml(params: {
  chaveAcesso?: string;
  mod?: string;
}): string {
  const idAttr = params.chaveAcesso ? ` Id="NFe${params.chaveAcesso}"` : "";
  const modTag = params.mod !== undefined ? `<mod>${params.mod}</mod>` : "";
  return `<NFe><infNFe${idAttr}><ide>${modTag}<nNF>1</nNF></ide></infNFe></NFe>`;
}

describe("BlingApiFetchQueue.findBlingInvoiceIdByChave", () => {
  let queue: BlingApiFetchQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BLING_UNIT_BUSINESS_ID = UNIT_BUSINESS_ID;
    queue = new BlingApiFetchQueue({ workless: true });
  });

  it("monta a query /nfe?chaveAcesso=&tipo= e retorna o id do primeiro resultado", async () => {
    const get = jest
      .fn()
      .mockResolvedValue({ data: { data: [{ id: 123 }] } });
    (blingApi as any).get = get;

    const id = await (queue as any).findBlingInvoiceIdByChave(
      CHAVE,
      "NF-e",
      0,
    );

    expect(get).toHaveBeenCalledWith(`/nfe?chaveAcesso=${CHAVE}&tipo=0`);
    expect(id).toBe(123);
  });

  it("usa /nfce pra NFC-e", async () => {
    const get = jest.fn().mockResolvedValue({ data: { data: [{ id: 456 }] } });
    (blingApi as any).get = get;

    const id = await (queue as any).findBlingInvoiceIdByChave(
      CHAVE,
      "NFC-e",
      1,
    );

    expect(get).toHaveBeenCalledWith(`/nfce?chaveAcesso=${CHAVE}&tipo=1`);
    expect(id).toBe(456);
  });

  it("retorna null quando a Bling não retorna nenhum resultado", async () => {
    (blingApi as any).get = jest.fn().mockResolvedValue({ data: { data: [] } });

    const id = await (queue as any).findBlingInvoiceIdByChave(
      CHAVE,
      "NF-e",
      0,
    );

    expect(id).toBeNull();
  });
});

describe("BlingApiFetchQueue.upsertInvoiceFromXml", () => {
  let queue: BlingApiFetchQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BLING_UNIT_BUSINESS_ID = UNIT_BUSINESS_ID;
    queue = new BlingApiFetchQueue({ workless: true });
  });

  it("lança erro quando o XML não tem chave de acesso", async () => {
    await expect(
      queue.upsertInvoiceFromXml(buildMinimalNfeXml({})),
    ).rejects.toThrow(/chave de acesso/i);
  });

  it("descobre a nota por chave (mod=55) e delega pra fetchAndUpsertInvoice como NF-e", async () => {
    const findSpy = jest
      .spyOn(queue as any, "findBlingInvoiceIdByChave")
      .mockResolvedValue(999);
    const fetchSpy = jest
      .spyOn(queue as any, "fetchAndUpsertInvoice")
      .mockResolvedValue(undefined);

    await queue.upsertInvoiceFromXml(
      buildMinimalNfeXml({ chaveAcesso: CHAVE, mod: "55" }),
    );

    // tenta tipo=0 (entrada) primeiro, já acha aí — nem chega a tentar tipo=1
    expect(findSpy).toHaveBeenCalledWith(CHAVE, "NF-e", 0);
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      { resource: "invoice", blingId: 999, action: "created", companyId: "" },
      "NF-e",
    );
  });

  it("descobre a nota por chave (mod=65) e delega como NFC-e/consumer_invoice", async () => {
    const findSpy = jest
      .spyOn(queue as any, "findBlingInvoiceIdByChave")
      .mockImplementation((...args: any[]) =>
        Promise.resolve(args[2] === 1 ? 777 : null),
      );
    const fetchSpy = jest
      .spyOn(queue as any, "fetchAndUpsertInvoice")
      .mockResolvedValue(undefined);

    await queue.upsertInvoiceFromXml(
      buildMinimalNfeXml({ chaveAcesso: CHAVE, mod: "65" }),
    );

    // tipo=0 não acha, cai pro tipo=1 (saída) dentro do mesmo type NFC-e
    expect(findSpy).toHaveBeenNthCalledWith(1, CHAVE, "NFC-e", 0);
    expect(findSpy).toHaveBeenNthCalledWith(2, CHAVE, "NFC-e", 1);
    expect(fetchSpy).toHaveBeenCalledWith(
      {
        resource: "consumer_invoice",
        blingId: 777,
        action: "created",
        companyId: "",
      },
      "NFC-e",
    );
  });

  it("sem mod reconhecível, tenta NF-e (tipo 0 e 1) antes de cair pra NFC-e", async () => {
    const findSpy = jest
      .spyOn(queue as any, "findBlingInvoiceIdByChave")
      .mockImplementation((...args: any[]) =>
        Promise.resolve(args[1] === "NFC-e" ? 111 : null),
      );
    const fetchSpy = jest
      .spyOn(queue as any, "fetchAndUpsertInvoice")
      .mockResolvedValue(undefined);

    await queue.upsertInvoiceFromXml(buildMinimalNfeXml({ chaveAcesso: CHAVE }));

    expect(findSpy).toHaveBeenNthCalledWith(1, CHAVE, "NF-e", 0);
    expect(findSpy).toHaveBeenNthCalledWith(2, CHAVE, "NF-e", 1);
    expect(findSpy).toHaveBeenNthCalledWith(3, CHAVE, "NFC-e", 0);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ blingId: 111 }),
      "NFC-e",
    );
  });

  it("lança erro quando a nota não é encontrada na Bling (nem NF-e nem NFC-e)", async () => {
    jest
      .spyOn(queue as any, "findBlingInvoiceIdByChave")
      .mockResolvedValue(null);
    const fetchSpy = jest.spyOn(queue as any, "fetchAndUpsertInvoice");

    await expect(
      queue.upsertInvoiceFromXml(buildMinimalNfeXml({ chaveAcesso: CHAVE })),
    ).rejects.toThrow(/não encontrada na Bling/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
