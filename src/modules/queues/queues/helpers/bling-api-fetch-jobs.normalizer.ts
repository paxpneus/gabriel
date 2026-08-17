import { QueueJobSummary } from "../../types/queue.types";

// Espelha (frouxamente) o formato de ApiFetchRequest do bling-webhook.mapper,
// sem acoplar diretamente ao módulo de webhook.
interface BlingApiFetchJobData {
  resource?: string;
  blingId?: number;
  action?: string;
  companyId?: string;
  partialData?: { number?: string; [key: string]: any };
  numero?: number | string;
  id?: number | string;
}

export interface NormalizedBlingApiFetchJob extends QueueJobSummary {
  resource: string | null;
  blingId: number | null;
  identifier: string | number | null;
}

function pickIdentifier(data: BlingApiFetchJobData): string | number | null {
  switch (data.resource) {
    case "invoice":
    case "consumer_invoice":
      return data.partialData?.number ?? data.blingId ?? null;

    case "product":
      return data.blingId ?? data.id ?? null;

    case "order":
      return data.numero ?? data.blingId ?? data.id ?? null;

    default:
      return data.blingId ?? data.id ?? null;
  }
}

export function normalizeBlingApiFetchJob(
  job: QueueJobSummary,
): NormalizedBlingApiFetchJob {
  const data = (job.data ?? {}) as BlingApiFetchJobData;

  return {
    ...job,
    resource: data.resource ?? null,
    blingId: data.blingId ?? null,
    identifier: pickIdentifier(data),
  };
}