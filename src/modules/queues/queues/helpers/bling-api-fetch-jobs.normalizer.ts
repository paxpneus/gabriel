import { QueueJobSummary } from "../../types/queue.types";

interface BlingApiFetchJobData {
  resource?: string;
  blingId?: number;
  action?: string;
  companyId?: string;
  partialData?: { number?: string; id?: number | string; blingId?: number; [key: string]: any };
  numero?: number | string;
  id?: number | string;
}

export interface NormalizedBlingApiFetchJob extends QueueJobSummary {
  resource: string | null;
  blingId: number | null;
  identifier: string | number | null;
}

function pickBlingId(data: BlingApiFetchJobData): number | null {
  const raw = data.blingId ?? data.partialData?.blingId ?? data.partialData?.id ?? null;
  if (raw == null) return null;
  const num = Number(raw);
  return Number.isNaN(num) ? null : num;
}

function pickIdentifier(data: BlingApiFetchJobData, blingId: number | null): string | number | null {
  switch (data.resource) {
    case "invoice":
      return data.partialData?.number ?? blingId ?? null;
    case "consumer_invoice":
      return data.partialData?.number ?? blingId ?? null;

    case "product":
      return blingId ?? data.id ?? null;

    case "order":
      return data.numero ?? blingId ?? data.id ?? null;

    default:
      return blingId ?? data.id ?? null;
  }
}

export function normalizeBlingApiFetchJob(
  job: QueueJobSummary,
): NormalizedBlingApiFetchJob {
  const data = (job.data ?? {}) as BlingApiFetchJobData;
  const blingId = pickBlingId(data);

  return {
    ...job,
    resource: data.resource ?? null,
    blingId,
    identifier: pickIdentifier(data, blingId),
  };
}