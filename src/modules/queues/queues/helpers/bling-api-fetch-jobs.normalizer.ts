import { QueueJobSummary } from "../../types/queue.types";

interface BlingApiFetchPayload {
  resource?: string;
  blingId?: number;
  action?: string;
  companyId?: string;
  partialData?: { number?: string; id?: number | string; blingId?: number; [key: string]: any };
  numero?: number | string;
  id?: number | string;
}

interface BlingApiFetchJobData {
  resource?: string;
  apiFetch?: BlingApiFetchPayload;
  // fallback: alguns produtores podem enviar os campos direto no raiz
  blingId?: number;
  partialData?: BlingApiFetchPayload["partialData"];
  numero?: number | string;
  id?: number | string;
}

export interface NormalizedBlingApiFetchJob extends QueueJobSummary {
  resource: string | null;
  blingId: number | null;
  identifier: string | number | null;
}

function pickBlingId(payload: BlingApiFetchPayload): number | null {
  const raw = payload.blingId ?? payload.partialData?.blingId ?? payload.partialData?.id ?? null;
  if (raw == null) return null;
  const num = Number(raw);
  return Number.isNaN(num) ? null : num;
}

function pickIdentifier(
  payload: BlingApiFetchPayload,
  blingId: number | null,
): string | number | null {
  switch (payload.resource) {
    case "invoice":
    case "consumer_invoice":
      return payload.partialData?.number ?? blingId ?? null;

    case "product":
      return blingId ?? payload.id ?? null;

    case "order":
      return payload.numero ?? blingId ?? payload.id ?? null;

    default:
      return blingId ?? payload.id ?? null;
  }
}

export function normalizeBlingApiFetchJob(
  job: QueueJobSummary,
): NormalizedBlingApiFetchJob {
  const data = (job.data ?? {}) as BlingApiFetchJobData;

  // O payload real fica em data.apiFetch; fallback pro raiz caso algum
  // produtor antigo/diferente mande os campos sem esse wrapper.
  const payload: BlingApiFetchPayload = data.apiFetch ?? {
    resource: data.resource,
    blingId: data.blingId,
    partialData: data.partialData,
    numero: data.numero,
    id: data.id,
  };

  const resource = payload.resource ?? data.resource ?? null;
  const blingId = pickBlingId(payload);

  return {
    ...job,
    resource,
    blingId,
    identifier: pickIdentifier(payload, blingId),
  };
}