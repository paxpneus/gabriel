import { createHash } from "crypto";
import redisService from "../../../shared/utils/base-models/base-redis";

// Relatório fica 1h no Redis; a rota de atualizar (ou o job que recalcula os snapshots) regrava/invalida antes disso.
export const REPORT_CACHE_TTL_SECONDS = 60 * 60;

// Prefixo de cache de cada relatório (usado no cache e na invalidação pelos jobs).
export const REPORT_CACHE_NAMES = {
  affiliatedReport: "affiliated-report",
  dailyOperationReport: "daily-operation-report",
  salesReport: "sales-report",
  integrationProblemsReport: "integration-problems-report",
  productStockFlow: "product-stock-flow",
  salesInvoicedReport: "sales-invoiced-report",
  salesReturnReport: "sales-return-report",
  saleTransferInvoiceReport: "sale-transfer-invoice-report",
  sellerCommissionReport: "seller-commission-report",
  sellerSalesReport: "seller-sales-report",
} as const;

type ReportCacheName = (typeof REPORT_CACHE_NAMES)[keyof typeof REPORT_CACHE_NAMES];

// Campo `cache` devolvido em todo relatório: quando foi gravado e quando expira (ISO); o front mostra o horário, não contagem.
export interface ReportCacheInfo {
  cached_at: string;
  expires_at: string;
}

// Relatório null (ex.: usuário não é afiliado) volta null, sem campo `cache`.
type WithCache<T> = T extends null ? null : T & { cache: ReportCacheInfo };

/** Cache-aside por relatório + filtros (sha1 do JSON); refresh=true ignora o cache, recalcula e regrava. Resultado null não é cacheado. */
export async function cachedReport<T extends object | null>(
  report: ReportCacheName,
  params: unknown,
  compute: () => Promise<T>,
  refresh = false,
): Promise<WithCache<T>> {
  const hash = createHash("sha1").update(JSON.stringify(params ?? null)).digest("hex");
  const key = `report:${report}:${hash}`;

  // Guarda o relatório junto com a hora da gravação, pra devolver quando expira.
  // Falha no Redis (fora do ar, memória cheia) só loga: o relatório é calculado e entregue sem cache, nunca 500.
  let envelope: { cached_at: string; data: T } | null = null;
  if (!refresh) {
    try {
      envelope = await redisService.get<{ cached_at: string; data: T }>(key);
    } catch (error) {
      console.error(`[report-cache] read failed for ${key}:`, error);
    }
  }

  // TEMP: log de hit/miss pra conferir o cache; remover depois.
  let status = "MISS";
  if (refresh) status = "REFRESH";
  else if (envelope?.data) status = `HIT (cached_at ${envelope.cached_at})`;
  console.log(`[report-cache] ${status} ${key}`);

  // Sem cache (ou chave no formato antigo, sem `data`): calcula e grava.
  if (!envelope?.data) {
    const data = await compute();
    if (data === null) return null as WithCache<T>;
    envelope = { cached_at: new Date().toISOString(), data };
    try {
      await redisService.set(key, envelope, { mode: "EX", duration: REPORT_CACHE_TTL_SECONDS });
    } catch (error) {
      console.error(`[report-cache] write failed for ${key}:`, error);
    }
  }

  const cache: ReportCacheInfo = {
    cached_at: envelope.cached_at,
    expires_at: new Date(Date.parse(envelope.cached_at) + REPORT_CACHE_TTL_SECONDS * 1000).toISOString(),
  };
  return { ...envelope.data, cache } as WithCache<T>;
}

/** Apaga o cache de todos os filtros dos relatórios; falha no Redis só loga, pra não derrubar o job que recalculou os dados. */
export async function invalidateReportCache(...reports: ReportCacheName[]): Promise<void> {
  try {
    await Promise.all(reports.map((report) => redisService.deleteByPattern(`report:${report}:*`)));
  } catch (error) {
    console.error("[ReportCache] Falha ao invalidar cache:", error instanceof Error ? error.message : error);
  }
}
