// Fachada da invoice carrega todos os services (Redis/BullMQ); aqui só os helpers SQL puros são usados, reais.
jest.mock("../../../warehouse/fiscal/invoices/invoice", () => ({
  __esModule: true,
  ...jest.requireActual("../../../warehouse/fiscal/invoices/invoice/shared/helpers/totals"),
  ...jest.requireActual("../../../warehouse/fiscal/invoices/invoice/shared/helpers/custom-filters"),
  ...jest.requireActual("../../../warehouse/fiscal/invoices/invoice/shared/helpers/nfe-ide"),
}));

// Redis em memória com NX/EX: a trava do refresh e o cache do relatório usam get/set/delete.
const store = new Map<string, { value: string; expiresAt: number }>();
const alive = (key: string) => {
  const entry = store.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry;
  store.delete(key);
  return undefined;
};
jest.mock("../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (key: string) => {
      const entry = alive(key);
      if (!entry) return null;
      try {
        return JSON.parse(entry.value);
      } catch {
        return entry.value;
      }
    }),
    set: jest.fn(async (key: string, value: unknown, options?: { duration?: number; condition?: string }) => {
      if (options?.condition === "NX" && alive(key)) return null;
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      store.set(key, { value: raw, expiresAt: Date.now() + (options?.duration ?? 3600) * 1000 });
      return "OK";
    }),
    delete: jest.fn(async (key: string) => void store.delete(key)),
  },
}));
// Fachada de contacts carrega sellers.service (cadeia que abre Redis/BullMQ e não deixa o Jest sair).
jest.mock("../../../sales/contacts", () => ({ __esModule: true, contactService: { findOne: jest.fn() } }));
jest.mock("../../../sales/coupons/contact-coupons/contact-coupons.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock("../../../sales/coupons/coupons/coupons.service", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
// O schema reaproveita o do controller do stock flow, que puxa user-permissions → config/routes (carrega todas as rotas).
jest.mock("../../../../middlewares/auth-token", () => ({ authenticate: jest.fn() }));
jest.mock("../../../../middlewares/user-permissions", () => ({ userPermissions: jest.fn() }));
jest.mock("../../product-stock-flow/services/main/product-stock-flow/product-stock-flow.service", () => ({
  __esModule: true,
  default: { getReport: jest.fn() },
}));

import { AffiliatedReportService } from "../affiliated-report.service";
import { AffiliatedReportQuerySchema } from "../schemas/affiliated-report.schema";

describe("AffiliatedReportService.refreshReport", () => {
  const service = new AffiliatedReportService({ findOrders: jest.fn() } as any);
  // Spy recriado a cada teste: o jest.config restaura os spies entre testes.
  let getReport: jest.SpyInstance;

  beforeEach(() => {
    store.clear();
    getReport = jest.spyOn(service, "getReport").mockResolvedValue({ summary: { total: 1 } } as any);
    jest.useFakeTimers().setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("atualiza 1 vez a cada 10 min por afiliado, mesmo trocando o período, e expõe refresh_available_at", async () => {
    const first = await service.refreshReport("user-1", "2026-11-01", "2026-11-30");
    expect(first.refreshAvailableAt).toBeUndefined();
    expect(first.report?.cache.refresh_available_at).toBe("2026-11-10T12:10:00.000Z");

    jest.setSystemTime(new Date("2026-11-10T12:04:48.000Z"));
    const blocked = await service.refreshReport("user-1", "2026-10-01", "2026-10-31");
    expect(blocked).toEqual({ report: null, refreshAvailableAt: "2026-11-10T12:10:00.000Z" });

    // GET continua respondendo do cache, com o mesmo horário de liberação.
    const cached = await service.getCachedReport("user-1", "2026-11-01", "2026-11-30");
    expect(cached?.cache.refresh_available_at).toBe("2026-11-10T12:10:00.000Z");

    // Outro afiliado não é afetado; liberação arredonda pro minuto cheio (12:14:48 → 12:15).
    const other = await service.refreshReport("user-2", "2026-11-01", "2026-11-30");
    expect(other.refreshAvailableAt).toBeUndefined();
    expect(other.report?.cache.refresh_available_at).toBe("2026-11-10T12:15:00.000Z");

    jest.setSystemTime(new Date("2026-11-10T12:10:00.000Z"));
    expect((await service.refreshReport("user-1", "2026-11-01", "2026-11-30")).refreshAvailableAt).toBeUndefined();
    expect(getReport).toHaveBeenCalledTimes(3);
  });

  it("sem trava ativa, refresh_available_at é agora", async () => {
    const report = await service.getCachedReport("user-1", "2026-11-01", "2026-11-30");
    expect(report?.cache.refresh_available_at).toBe("2026-11-10T12:00:00.000Z");
  });

  it("usuário que não é afiliado ou erro no cálculo não consome a janela", async () => {
    getReport.mockResolvedValueOnce(null);
    expect(await service.refreshReport("user-1", "2026-11-01", "2026-11-30")).toEqual({ report: null });

    getReport.mockRejectedValueOnce(new Error("boom"));
    await expect(service.refreshReport("user-1", "2026-11-01", "2026-11-30")).rejects.toThrow("boom");

    expect((await service.refreshReport("user-1", "2026-11-01", "2026-11-30")).refreshAvailableAt).toBeUndefined();
  });
});

describe("AffiliatedReportQuerySchema", () => {
  const parse = (start_date: string, end_date: string) => AffiliatedReportQuerySchema.safeParse({ start_date, end_date });

  it("aceita até 1 ano (fim antes do mesmo dia do ano seguinte)", () => {
    expect(parse("2026-01-01", "2026-12-31").success).toBe(true);
    expect(parse("2026-11-10", "2027-11-09").success).toBe(true);
    expect(parse("2028-02-29", "2029-02-28").success).toBe(true);
  });

  it("recusa período acima de 1 ano", () => {
    const result = parse("2026-01-01", "2027-01-01");
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain("O período não pode ser maior que 1 ano");
  });
});
