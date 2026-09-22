import { Job } from "bullmq";

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

import { MLScrapingQueue } from "../mercado-livre.scraping.queue";
import { MLScrapingJobData } from "../mercado-livre.types";

function makeJob(data: MLScrapingJobData): Job<MLScrapingJobData> {
  return { data } as Job<MLScrapingJobData>;
}

describe("MLScrapingQueue", () => {
  let scrapingServiceFake: { scrapeOrderDetail: jest.Mock };
  let nextFake: { add: jest.Mock };
  let queue: MLScrapingQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    scrapingServiceFake = { scrapeOrderDetail: jest.fn() };
    nextFake = { add: jest.fn().mockResolvedValue(undefined) };
    queue = new MLScrapingQueue(scrapingServiceFake as any, nextFake as any, {
      workless: true,
    });
  });

  it("extrai com sucesso: devolve o resultado pra ML_ORDER_SYNC via jobId fixo por pedido", async () => {
    const result = {
      order_number: "2000015145652229",
      collection_date: new Date("2026-09-21"),
    };
    scrapingServiceFake.scrapeOrderDetail.mockResolvedValue(result);

    await queue.process(
      makeJob({ orderId: "order-1", numberOrderChannel: "2000015145652229" }),
    );

    expect(scrapingServiceFake.scrapeOrderDetail).toHaveBeenCalledWith(
      "2000015145652229",
    );
    expect(nextFake.add).toHaveBeenCalledWith(
      { scrapedOrderId: "order-1", scrapeResult: result },
      "ml-order-sync-scraped-order-1",
    );
  });

  it("scraping não encontra nenhuma condição (retorna null): devolve null pra ML_ORDER_SYNC mesmo assim", async () => {
    scrapingServiceFake.scrapeOrderDetail.mockResolvedValue(null);

    await queue.process(
      makeJob({ orderId: "order-1", numberOrderChannel: "2000015145652229" }),
    );

    expect(nextFake.add).toHaveBeenCalledWith(
      { scrapedOrderId: "order-1", scrapeResult: null },
      "ml-order-sync-scraped-order-1",
    );
  });

  it("scraping lança erro (ex: falha de login/Playwright): não quebra, devolve null pra ML_ORDER_SYNC", async () => {
    scrapingServiceFake.scrapeOrderDetail.mockRejectedValue(new Error("boom"));

    await expect(
      queue.process(
        makeJob({ orderId: "order-1", numberOrderChannel: "2000015145652229" }),
      ),
    ).resolves.toBeUndefined();

    expect(nextFake.add).toHaveBeenCalledWith(
      { scrapedOrderId: "order-1", scrapeResult: null },
      "ml-order-sync-scraped-order-1",
    );
  });
});
