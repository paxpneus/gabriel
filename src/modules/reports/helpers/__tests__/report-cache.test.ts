// Redis em memória: o helper só usa get/set.
const store = new Map<string, unknown>();
jest.mock("../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.parse(JSON.stringify(value)));
      return "OK";
    }),
    deleteByPattern: jest.fn(),
  },
}));

import redisService from "../../../../shared/utils/base-models/base-redis";
import { cachedReport, REPORT_CACHE_NAMES } from "../report-cache";

describe("cachedReport", () => {
  beforeEach(() => {
    store.clear();
    jest.useFakeTimers().setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("calcula na 1ª chamada e serve do cache depois, com o horário em que expira", async () => {
    const compute = jest.fn().mockResolvedValue({ total: 10 });

    const first = await cachedReport(REPORT_CACHE_NAMES.salesReport, { a: 1 }, compute);
    expect(first).toEqual({
      total: 10,
      cache: {
        cached_at: "2026-11-10T12:00:00.000Z",
        expires_at: "2026-11-10T13:00:00.000Z",
      },
    });

    jest.setSystemTime(new Date("2026-11-10T12:45:00.000Z"));
    const second = await cachedReport(REPORT_CACHE_NAMES.salesReport, { a: 1 }, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second?.cache).toEqual({
      cached_at: "2026-11-10T12:00:00.000Z",
      expires_at: "2026-11-10T13:00:00.000Z",
    });
  });

  it("filtros diferentes não compartilham cache e refresh recalcula e regrava", async () => {
    const compute = jest.fn<Promise<{ v: number }>, []>().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 }).mockResolvedValueOnce({ v: 3 });

    await cachedReport(REPORT_CACHE_NAMES.salesReport, { a: 1 }, compute);
    const other = await cachedReport(REPORT_CACHE_NAMES.salesReport, { a: 2 }, compute);
    expect(other?.v).toBe(2);

    jest.setSystemTime(new Date("2026-11-10T12:30:00.000Z"));
    const refreshed = await cachedReport(REPORT_CACHE_NAMES.salesReport, { a: 1 }, compute, true);
    expect(refreshed?.v).toBe(3);
    expect(refreshed?.cache.cached_at).toBe("2026-11-10T12:30:00.000Z");

    const afterRefresh = await cachedReport(REPORT_CACHE_NAMES.salesReport, { a: 1 }, compute);
    expect(afterRefresh?.v).toBe(3);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("resultado null volta null e não é cacheado", async () => {
    const compute = jest.fn().mockResolvedValue(null);

    await expect(cachedReport(REPORT_CACHE_NAMES.affiliatedReport, { u: 1 }, compute)).resolves.toBeNull();
    await cachedReport(REPORT_CACHE_NAMES.affiliatedReport, { u: 1 }, compute);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  it("Redis fora do ar ou cheio: entrega o relatório calculado, sem 500", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (redisService.get as jest.Mock).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    (redisService.set as jest.Mock).mockRejectedValueOnce(new Error("OOM command not allowed"));
    const compute = jest.fn<Promise<{ total: number }>, []>().mockResolvedValue({ total: 7 });

    const report = await cachedReport(REPORT_CACHE_NAMES.salesReport, { a: 1 }, compute);
    expect(report?.total).toBe(7);
    expect(report?.cache.cached_at).toBe("2026-11-10T12:00:00.000Z");
    expect(store.size).toBe(0);
  });
});
