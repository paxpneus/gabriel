import { Job } from "bullmq";

// ─── Mocks de infraestrutura (Redis/BullMQ) — TCarUpsertQueue extends
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
}));

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

// tecinco-api-fetch.queue.ts arrasta shared/utils/xml/invoice-xml ->
// invoice.service, que abre uma conexão real (sqlite) via config/sequelize —
// mocka-se aqui só pra evitar carregar o binding nativo do sqlite3 no teste.
jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb({})) },
}));

jest.mock("../../api/tecinco_api", () => ({
  __esModule: true,
  getTCarIntegration: jest.fn(),
}));

jest.mock("../../service/produtos/produtos.service", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ obterProduto: jest.fn() })),
}));

jest.mock("../../service/clientes/clientes.service", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

// extractProductMeasureAndLine é importado do arquivo do Bling, que arrasta
// um grafo enorme de dependências (Magento, stock-movements, etc.) — mocka-se
// o módulo inteiro pra isolar o teste do TCarUpsertQueue.
jest.mock("../../../bling/services/bling/queues/bling-api-fetch.queue", () => ({
  __esModule: true,
  extractProductMeasureAndLine: jest.fn().mockReturnValue({
    measure: null,
    line: null,
    rim: null,
  }),
}));

jest.mock("../helpers/customer.helper", () => ({
  __esModule: true,
  upsertCustomerFromTCar: jest.fn(),
}));

jest.mock("../../../../inventory/brands/brands.service", () => ({
  __esModule: true,
  default: { findSimilarBrand: jest.fn() },
}));

jest.mock(
  "../../../../integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: {
      createOrUpdateIntegrationMapping: jest.fn(),
      findEntityByMapping: jest.fn(),
    },
  }),
);

jest.mock("../../../../inventory/products/services/product.service", () => ({
  __esModule: true,
  default: { upsertWithComponents: jest.fn() },
}));

jest.mock("../helpers/product.helpers", () => ({
  __esModule: true,
  normalizeEan: jest.fn((ean?: string) => ean),
  resolveProductWithMapping: jest.fn(),
  ensureSupplierMappings: jest.fn(),
}));

import { getTCarIntegration } from "../../api/tecinco_api";
import brandsService from "../../../../inventory/brands/brands.service";
import productService from "../../../../inventory/products/services/product.service";
import {
  resolveProductWithMapping,
  ensureSupplierMappings,
} from "../helpers/product.helpers";
import Product from "../../../../inventory/products/product.model";
import ProductConfig from "../../../../inventory/product-config/product_config.model";
import UnitBusiness from "../../../../company/unit-business/unit-business.model";
import Group from "../../../../inventory/groups/group/group.model";
import Subgroup from "../../../../inventory/groups/subgroup/subgroup.model";
import Stock from "../../../../inventory/stock/stock/stock.model";
import { TCarUpsertQueue } from "../tecinco-api-fetch.queue";
import { TCarProdutoPayload } from "../../service/tecinco/tecinco.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INTEGRATION_ID = "tecinco-integration-1";
const UNIT_BUSINESS_ID = "ub-tecinco-1";

function makeTecincoProduto(
  overrides: Partial<TCarProdutoPayload> = {},
): TCarProdutoPayload {
  return {
    fll_codigo: 1,
    epctb_codigo: "700001",
    epctb_codigofabrica: "FAB-700001",
    epctb_nome: "Pneu Aro 14 Pirelli",
    epctb_ean: "7891234567890",
    epctb_unidade: "UN",
    epctb_pesobruto: 9.5,
    epctb_pesoliq: 9.0,
    epcte_estoque: 12,
    epcte_custcont: 250,
    epprc_preco: 400,
    grupo_descricao: "PNEUS",
    subgrupo_descricao: "ARO 14",
    marca_descricao: "Pirelli",
    ...overrides,
  } as TCarProdutoPayload;
}

function makeUpsertedProduct(overrides: Partial<any> = {}) {
  return { id: "upserted-tecinco-product-id", ...overrides };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("TCarUpsertQueue.processProduct", () => {
  let queue: TCarUpsertQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    queue = new TCarUpsertQueue({ workless: true });

    (getTCarIntegration as jest.Mock).mockResolvedValue({
      id: INTEGRATION_ID,
    });
    (UnitBusiness.findOne as jest.Mock).mockResolvedValue({
      id: UNIT_BUSINESS_ID,
      cnpj: "11222333000144",
    });
    (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);
    (ensureSupplierMappings as jest.Mock).mockResolvedValue(undefined);
    (brandsService.findSimilarBrand as jest.Mock).mockResolvedValue(null);
    (Group.findOne as jest.Mock).mockResolvedValue({ id: "group-1", name: "PNEUS" });
    (Subgroup.findOne as jest.Mock).mockResolvedValue({
      id: "subgroup-1",
      name: "ARO 14",
    });
    (productService.upsertWithComponents as jest.Mock).mockResolvedValue(
      makeUpsertedProduct(),
    );
    (Stock.findOne as jest.Mock).mockResolvedValue(null);
  });

  function runProductJob(
    action: "created" | "updated" | "deleted",
    data: TCarProdutoPayload,
  ) {
    return queue.process({
      data: {
        eventId: "evt-1",
        resource: "product",
        action,
        companyId: "company-1",
        branchId: data.fll_codigo,
        data,
      },
    } as unknown as Job<any>);
  }

  // ── ação deleted ─────────────────────────────────────────────────────────

  it("ação deleted: remove o produto e não chama o upsert central", async () => {
    const produto = makeTecincoProduto();

    await runProductJob("deleted", produto);

    expect(Product.destroy).toHaveBeenCalledWith({
      where: { id_system: String(produto.epctb_codigo) },
    });
    expect(productService.upsertWithComponents).not.toHaveBeenCalled();
  });

  // ── produto sem id (novo, não mapeado) ───────────────────────────────────

  describe("produto sem id (novo, ainda não mapeado)", () => {
    it("cria uma única vez via upsert central, com fallback por id_system e sem componentes de kit", async () => {
      const produto = makeTecincoProduto();
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);

      await runProductJob("updated", produto);

      expect(productService.upsertWithComponents).toHaveBeenCalledTimes(1);
      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({
          id: undefined,
          conflictFields: ["id_system"],
          values: expect.objectContaining({
            id_system: String(produto.epctb_codigo),
          }),
        }),
      );
      // Tecinco não manda composição de kit — components nunca é passado.
      const callArgs = (productService.upsertWithComponents as jest.Mock).mock
        .calls[0][0];
      expect(callArgs.components).toBeUndefined();
    });

    it("registra o supplier mapping exatamente uma vez, sem duplicar", async () => {
      const produto = makeTecincoProduto();
      (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);

      await runProductJob("updated", produto);

      expect(ensureSupplierMappings).toHaveBeenCalledTimes(1);
      expect(ensureSupplierMappings).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: "upserted-tecinco-product-id",
          supplierCnpj: "11222333000144",
          ean: produto.epctb_ean,
          codigoFabrica: produto.epctb_codigofabrica,
        }),
      );
    });
  });

  // ── produto já existente (evita duplicar) ────────────────────────────────

  describe("produto já existente (mesma integração)", () => {
    it("atualiza (não cria de novo) — upsert central chamado com o id já resolvido", async () => {
      const produto = makeTecincoProduto();
      (resolveProductWithMapping as jest.Mock).mockResolvedValue({
        id: "existing-tecinco-product-id",
        integrations_id: INTEGRATION_ID,
      });
      (productService.upsertWithComponents as jest.Mock).mockResolvedValue(
        makeUpsertedProduct({ id: "existing-tecinco-product-id" }),
      );

      await runProductJob("updated", produto);

      expect(productService.upsertWithComponents).toHaveBeenCalledTimes(1);
      expect(productService.upsertWithComponents).toHaveBeenCalledWith(
        expect.objectContaining({ id: "existing-tecinco-product-id" }),
      );
    });
  });

  // ── produto de outra integração (apenas vincula, não duplica) ────────────

  describe("produto pertence a outra integração", () => {
    it("não chama o upsert central de produto (evita sobrescrever o dono), mas garante ProductConfig e supplier mapping uma única vez", async () => {
      const produto = makeTecincoProduto();
      (resolveProductWithMapping as jest.Mock).mockResolvedValue({
        id: "other-integration-product-id",
        integrations_id: "outra-integracao-id",
      });

      await runProductJob("updated", produto);

      expect(productService.upsertWithComponents).not.toHaveBeenCalled();
      expect(ProductConfig.upsert).toHaveBeenCalledTimes(1);
      expect(ProductConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          product_id: "other-integration-product-id",
          unit_business_id: UNIT_BUSINESS_ID,
        }),
        expect.anything(),
      );
      expect(ensureSupplierMappings).toHaveBeenCalledTimes(1);
      expect(ensureSupplierMappings).toHaveBeenCalledWith(
        expect.objectContaining({ productId: "other-integration-product-id" }),
      );
    });

    it("sem CNPJ da unit business: não registra ProductConfig nem supplier mapping (evita mapping incompleto/duplicado)", async () => {
      const produto = makeTecincoProduto();
      (resolveProductWithMapping as jest.Mock).mockResolvedValue({
        id: "other-integration-product-id",
        integrations_id: "outra-integracao-id",
      });
      (UnitBusiness.findOne as jest.Mock).mockResolvedValue({
        id: UNIT_BUSINESS_ID,
        cnpj: null,
      });

      await runProductJob("updated", produto);

      expect(ProductConfig.upsert).not.toHaveBeenCalled();
      expect(ensureSupplierMappings).not.toHaveBeenCalled();
    });
  });

  // ── unit business não encontrada ─────────────────────────────────────────

  it("unit business não encontrada: salva o produto mas não cria ProductConfig/supplier mapping", async () => {
    const produto = makeTecincoProduto({ fll_codigo: 999 });
    (UnitBusiness.findOne as jest.Mock).mockResolvedValue(null);

    await runProductJob("updated", produto);

    expect(productService.upsertWithComponents).toHaveBeenCalledTimes(1);
    expect(ProductConfig.upsert).not.toHaveBeenCalled();
    expect(ensureSupplierMappings).not.toHaveBeenCalled();
  });

  // ── Tecinco nunca sincroniza kit_components ──────────────────────────────

  it("mesmo com um código de produto no padrão de kit da Bling (sufixo K2), não monta nem envia composição de kit", async () => {
    const produto = makeTecincoProduto({
      epctb_codigo: "700001K2",
      epctb_codigofabrica: "FAB-700001K2",
    });
    (resolveProductWithMapping as jest.Mock).mockResolvedValue(null);

    await runProductJob("updated", produto);

    const callArgs = (productService.upsertWithComponents as jest.Mock).mock
      .calls[0][0];
    expect(callArgs.components).toBeUndefined();
    expect(callArgs.values.type).toBeUndefined();
  });
});
