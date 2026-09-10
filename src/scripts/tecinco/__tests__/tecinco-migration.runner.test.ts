// ─── Mocks de infraestrutura (Redis/BullMQ) — tecinco-migration.runner.ts
// importa TCarUpsertQueue (extends BaseQueueService, que abre Queue/Redis
// reais no construtor) só pelo tipo, mas o módulo inteiro ainda é carregado
// na importação — sem esses mocks o teste trava tentando conectar em infra
// de verdade. Nenhum teste desta suite deve abrir conexão real. ──────────

jest.mock("../../../config/redis", () => ({
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
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn(), getJobCounts: jest.fn().mockResolvedValue({}) })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

jest.mock("../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

jest.mock("../../../modules/handlers/tecinco/api/tecinco_api", () => ({
  __esModule: true,
  getTCarIntegration: jest.fn(),
}));

jest.mock("../../../modules/handlers/tecinco/service/clientes/clientes.service", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

jest.mock(
  "../../../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue",
  () => ({
    __esModule: true,
    extractProductMeasureAndLine: jest.fn().mockReturnValue({
      measure: null,
      line: null,
      rim: null,
    }),
  }),
);

jest.mock("../../../modules/handlers/tecinco/queues/helpers/customer.helper", () => ({
  __esModule: true,
  upsertCustomerFromTCar: jest.fn(),
}));

jest.mock("../../../modules/inventory/brands/brands.service", () => ({
  __esModule: true,
  default: { findSimilarBrand: jest.fn(), findOrCreateBrand: jest.fn() },
}));

jest.mock("../../../modules/inventory/products/services/product.service", () => ({
  __esModule: true,
  default: { upsertWithComponents: jest.fn(), create: jest.fn(), findAll: jest.fn() },
}));

jest.mock(
  "../../../modules/integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: {
      createOrUpdateIntegrationMapping: jest.fn(),
      findEntityByMapping: jest.fn(),
      findValidExternalIdsSet: jest.fn(),
    },
  }),
);

// listarProdutos precisa ser o MESMO jest.fn() em toda instância de
// TCarProdutoService — migrateProdutos e fetchTecincoCatalog (chamado por
// dentro dele) criam instâncias separadas via `new TCarProdutoService()`.
const listarProdutosMock = jest.fn();
jest.mock("../../../modules/handlers/tecinco/service/produtos/produtos.service", () => ({
  __esModule: true,
  TCarProdutoService: jest.fn().mockImplementation(() => ({
    listarProdutos: listarProdutosMock,
    obterProduto: jest.fn(),
  })),
}));

import * as fs from "fs";
import {
  buildTecincoDuplicateValueSets,
  findTecincoCollidingFields,
  migrateProdutos,
} from "../tecinco-migration.runner";
import { TecincoCatalogItem, CATALOG_OUTPUT_PATH } from "../dump-tecinco-catalog";
import { getTCarIntegration } from "../../../modules/handlers/tecinco/api/tecinco_api";
import integrationMappingService from "../../../modules/integrations/integration-mapping/integration-mapping.service";

function makeItem(overrides: Partial<TecincoCatalogItem> = {}): TecincoCatalogItem {
  return {
    id_sistema: "1",
    sku: null,
    coded: null,
    ean: null,
    nome: "Produto teste",
    grupo: null,
    subgrupo: null,
    marca: null,
    ...overrides,
  };
}

describe("buildTecincoDuplicateValueSets", () => {
  it("marca como duplicado um valor de sku que se repete em 2 produtos diferentes", () => {
    const items = [
      makeItem({ id_sistema: "1", sku: "48681" }),
      makeItem({ id_sistema: "2", sku: "48681" }),
      makeItem({ id_sistema: "3", sku: "unico" }),
    ];

    const sets = buildTecincoDuplicateValueSets(items);

    expect(sets.sku.has("48681")).toBe(true);
    expect(sets.sku.has("unico")).toBe(false);
  });

  it("mesmo repetindo muitas vezes (não é só um caso raro de coincidência), continua marcando como duplicado", () => {
    const items = Array.from({ length: 64 }, (_, i) =>
      makeItem({ id_sistema: String(i), sku: "48681" }),
    );

    const sets = buildTecincoDuplicateValueSets(items);

    expect(sets.sku.has("48681")).toBe(true);
  });

  it("não marca sku/coded vazio, null ou em branco como duplicado mesmo aparecendo em vários produtos", () => {
    const items = [
      makeItem({ id_sistema: "1", sku: null }),
      makeItem({ id_sistema: "2", sku: "" }),
      makeItem({ id_sistema: "3", sku: "   " }),
      makeItem({ id_sistema: "4", sku: null, coded: null }),
    ];

    const sets = buildTecincoDuplicateValueSets(items);

    expect(sets.sku.size).toBe(0);
  });

  it("não marca ean 'SEM GTIN' (em qualquer variação) como duplicado, mesmo repetido em vários produtos", () => {
    const items = [
      makeItem({ id_sistema: "1", ean: "SEM GTIN" }),
      makeItem({ id_sistema: "2", ean: "SEMGTIN" }),
      makeItem({ id_sistema: "3", ean: "sem gtin" }),
    ];

    const sets = buildTecincoDuplicateValueSets(items);

    expect(sets.ean.size).toBe(0);
  });

  it("sku e ean são índices independentes — duplicidade num campo não contamina o outro", () => {
    const items = [
      makeItem({ id_sistema: "1", sku: "Y", ean: "Z" }),
      makeItem({ id_sistema: "2", sku: "diferente", ean: "diferente" }),
    ];

    const sets = buildTecincoDuplicateValueSets(items);

    expect(sets.sku.has("Y")).toBe(false);
    expect(sets.ean.has("Z")).toBe(false);
  });

  it("usa coded (epctb_coded) como fallback pro eixo de sku só quando não há código de fábrica", () => {
    const items = [
      makeItem({ id_sistema: "1", sku: null, coded: "C1" }),
      makeItem({ id_sistema: "2", sku: null, coded: "C1" }),
      makeItem({ id_sistema: "3", sku: "C1", coded: null }),
    ];

    const sets = buildTecincoDuplicateValueSets(items);

    expect(sets.sku.has("C1")).toBe(true);
  });

  it("código de fábrica presente tem prioridade sobre coded — coded não entra no eixo de sku nesse caso", () => {
    const items = [
      makeItem({ id_sistema: "1", sku: "FAB", coded: "SAME" }),
      makeItem({ id_sistema: "2", sku: "outro", coded: "SAME" }),
    ];

    const sets = buildTecincoDuplicateValueSets(items);

    expect(sets.sku.has("SAME")).toBe(false);
  });
});

describe("findTecincoCollidingFields", () => {
  const items = [
    makeItem({ id_sistema: "23206", sku: "48681", ean: "" }),
    makeItem({ id_sistema: "23890", sku: "48681", ean: "SEM GTIN" }),
    makeItem({ id_sistema: "23953", sku: "48681", ean: "SEM GTIN" }),
  ];
  const sets = buildTecincoDuplicateValueSets(items);

  it("reproduz o incidente real: 3 produtos completamente diferentes compartilhando o mesmo sku ficam marcados", () => {
    expect(findTecincoCollidingFields({ sku: "48681" }, sets)).toEqual([
      "sku=48681",
    ]);
  });

  it("produto sem nenhum código colidindo retorna lista vazia", () => {
    expect(
      findTecincoCollidingFields({ coded: "x", sku: "unico", ean: "7891234567890" }, sets),
    ).toEqual([]);
  });

  it("pode colidir em mais de um campo ao mesmo tempo", () => {
    const dupItems = [
      makeItem({ id_sistema: "1", sku: "S1", ean: "E1" }),
      makeItem({ id_sistema: "2", sku: "S1", ean: "E1" }),
    ];
    const dupSets = buildTecincoDuplicateValueSets(dupItems);

    expect(findTecincoCollidingFields({ sku: "S1", ean: "E1" }, dupSets)).toEqual([
      "sku=S1",
      "ean=E1",
    ]);
  });
});

describe("migrateProdutos — flags de duplicidade no payload do job", () => {
  const INTEGRATION_ID = "integration-1";

  beforeEach(() => {
    jest.clearAllMocks();
    if (fs.existsSync(CATALOG_OUTPUT_PATH)) fs.unlinkSync(CATALOG_OUTPUT_PATH);

    (getTCarIntegration as jest.Mock).mockResolvedValue({ id: INTEGRATION_ID });
  });

  afterEach(() => {
    if (fs.existsSync(CATALOG_OUTPUT_PATH)) fs.unlinkSync(CATALOG_OUTPUT_PATH);
  });

  function makeProduto(overrides: Record<string, unknown> = {}) {
    return {
      fll_codigo: 12,
      epctb_codigo: "1",
      epctb_codigofabrica: null,
      epctb_coded: null,
      epctb_ean: null,
      epctb_nome: "Produto teste",
      grupo_descricao: "PNEUS",
      ...overrides,
    };
  }

  it("sempre enfileira TODO item (colidindo ou não, mapeado ou não), anexando skuDuplicated/eanDuplicated corretamente no payload", async () => {
    // sku "DUP" colide entre systemId 1 e 2 (nenhum mapeado ainda).
    // sku "DUP2" colide entre systemId 4 (já mapeado) e 5 (não mapeado) —
    // a flag deve valer pros dois, mapeado ou não: quem decide o que fazer
    // com ela agora é o processProduct, não o migrateProdutos.
    // sku "UNICO" não colide com nada (systemId 3).
    const catalogo = [
      makeProduto({ epctb_codigo: "1", epctb_codigofabrica: "DUP" }),
      makeProduto({ epctb_codigo: "2", epctb_codigofabrica: "DUP" }),
      makeProduto({ epctb_codigo: "3", epctb_codigofabrica: "UNICO" }),
      makeProduto({ epctb_codigo: "4", epctb_codigofabrica: "DUP2" }),
      makeProduto({ epctb_codigo: "5", epctb_codigofabrica: "DUP2" }),
    ];

    listarProdutosMock.mockImplementation((_branchId: number, options: any) => {
      if (options?.grupo && options.grupo !== "10") {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: catalogo });
    });

    (integrationMappingService.findValidExternalIdsSet as jest.Mock).mockResolvedValue(
      new Set(["4"]),
    );

    const upsertQueue = {
      add: jest.fn().mockResolvedValue({ id: "job-1" }),
      queue: { getJobCounts: jest.fn().mockResolvedValue({ active: 0, waiting: 0, delayed: 0 }) },
    } as any;

    await migrateProdutos({
      branchIds: [12],
      companyId: "company-1",
      alteradoDesde: "",
      upsertQueue,
      dryRun: false,
      grupos: ["10"],
    });

    const calls = (upsertQueue.add as jest.Mock).mock.calls;
    const byJobId = new Map(calls.map((call) => [call[1], call[0]]));

    expect([...byJobId.keys()].sort()).toEqual([
      "product-1",
      "product-2",
      "product-3",
      "product-4",
      "product-5",
    ]);

    expect(byJobId.get("product-1")).toMatchObject({ skuDuplicated: true, eanDuplicated: false });
    expect(byJobId.get("product-2")).toMatchObject({ skuDuplicated: true, eanDuplicated: false });
    expect(byJobId.get("product-3")).toMatchObject({ skuDuplicated: false, eanDuplicated: false });
    expect(byJobId.get("product-4")).toMatchObject({ skuDuplicated: true, eanDuplicated: false });
    expect(byJobId.get("product-5")).toMatchObject({ skuDuplicated: true, eanDuplicated: false });

    // Não sobra JSON intermediário no disco depois que o índice foi montado.
    expect(fs.existsSync(CATALOG_OUTPUT_PATH)).toBe(false);
  });
});
