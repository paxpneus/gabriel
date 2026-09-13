import { Job } from "bullmq";

// ─── Mocks de infraestrutura (Redis/BullMQ) — MLScrapingQueue extends
// BaseQueueService, que cria Queue/QueueEvents/Worker reais no construtor
// mesmo com workless:true. O Worker é stub (não roda de verdade nos
// testes), então o wrapping por sharedLock (SCRAPING_SHARED_QUEUE_LOCK)
// nunca é exercitado aqui — os testes chamam queue.process(job) direto,
// igual aos outros arquivos de teste deste pipeline. ───────────────────────

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

jest.mock("../../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: { getFullOrdersByQuery: jest.fn() },
}));

// Evita que o import transitivo de BaseQueueService dispare uma verificação
// real de SMTP (nodemailer) durante os testes — mesmo mock já usado nos
// outros arquivos de teste deste pipeline.
jest.mock("../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

jest.mock("../../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
  redisConnection: {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn(),
    eval: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    zrange: jest.fn(),
    exists: jest.fn(),
  },
}));

import ordersService from "../../../../sales/orders/order/orders.service";
import redisService from "../../../../../shared/utils/base-models/base-redis";
import { MLScrapingQueue } from "../mercado-livre.scraping.queue";
import { MLExcelRow } from "../mercado-livre.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<MLExcelRow> = {}): MLExcelRow {
  return {
    order_number: "ML-1",
    collection_date: new Date("2026-08-11T00:00:00.000Z"),
    sale_date: new Date("2026-08-11T10:00:00.000Z"),
    sku: "SKU1",
    revenue_brl: 100,
    buyer: "Fulano",
    business: "loja-x",
    cpf: "00000000000",
    ...overrides,
  };
}

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-1",
    date: "2026-08-11T00:00:00.000Z",
    internal_status: "WAITING CHANNEL VALIDATION",
    collection_date: null,
    customer: { name: "Fulano De Tal" },
    items: [],
    ...overrides,
  };
}

describe("MLScrapingQueue", () => {
  let scrapingService: { downloadAndParseExcel: jest.Mock };
  let mlOrderService: { updateCache: jest.Mock };
  let next: { add: jest.Mock };
  let queue: MLScrapingQueue;

  beforeEach(() => {
    jest.clearAllMocks();

    scrapingService = { downloadAndParseExcel: jest.fn().mockResolvedValue([]) };
    mlOrderService = { updateCache: jest.fn() };
    next = { add: jest.fn() };

    queue = new MLScrapingQueue(
      scrapingService as any,
      mlOrderService as any,
      next as any,
      { workless: true },
    );

    (ordersService.getFullOrdersByQuery as jest.Mock).mockResolvedValue([]);
    (redisService.set as jest.Mock).mockResolvedValue(undefined);
  });

  it("nenhum pedido pendente (WAITING CHANNEL VALIDATION sem collection_date): não baixa a planilha nem enfileira nada", async () => {
    (ordersService.getFullOrdersByQuery as jest.Mock).mockResolvedValue([
      makeOrder({ internal_status: "EMITTED", collection_date: new Date() }),
    ]);

    await queue.process({ data: {} } as Job<any>);

    expect(scrapingService.downloadAndParseExcel).not.toHaveBeenCalled();
    expect(next.add).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it("existe pedido pendente: baixa a planilha, enfileira só as linhas relevantes e grava o cache com a lista completa", async () => {
    jest.useFakeTimers();

    const pendingOrder = makeOrder();
    const otherOrder = makeOrder({
      id: "order-2",
      internal_status: "EMITTED",
      collection_date: new Date(),
      customer: { name: "Beltrano" },
    });
    (ordersService.getFullOrdersByQuery as jest.Mock).mockResolvedValue([
      pendingOrder,
      otherOrder,
    ]);

    const relevantRow = makeRow({ order_number: "ML-RELEVANT", buyer: "Fulano" });
    const irrelevantRow = makeRow({ order_number: "ML-IRRELEVANT", buyer: "Ninguem Conhecido" });
    scrapingService.downloadAndParseExcel.mockResolvedValue([relevantRow, irrelevantRow]);

    const pending = queue.process({ data: {} } as Job<any>);
    // process() dorme 1-3min de jitter antes de baixar a planilha, só quando
    // há pedido pendente — sem isso o teste ficaria pendurado.
    await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
    await pending;

    jest.useRealTimers();

    expect(scrapingService.downloadAndParseExcel).toHaveBeenCalledTimes(1);
    expect(next.add).toHaveBeenCalledTimes(1);
    expect(next.add).toHaveBeenCalledWith(
      { row: relevantRow },
      "ml-sync-ML-RELEVANT",
    );

    // O cache orders_seven_days_ago continua com a lista completa (pendente
    // + não-pendente) — o filtro é só sobre quais linhas viram job, a busca
    // de "irmãos" dentro de MLOrderSyncQueue depende da lista inteira.
    expect(redisService.set).toHaveBeenCalledWith(
      "orders_seven_days_ago",
      [pendingOrder, otherOrder],
      { mode: "EX", duration: 60 * 30 },
    );
  });
});
