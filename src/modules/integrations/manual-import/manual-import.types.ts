import type { BlingApiFetchQueue } from "../../handlers/bling/services/bling/queues/bling-api-fetch.queue";
import type { BlingOrderQueue } from "../../handlers/bling/services/bling-orders/bling-order.queue";
import type { TCarUpsertQueue } from "../../handlers/tecinco/queues/tecinco-api-fetch.queue";
import type { TCarInvoiceQueue } from "../../handlers/tecinco/queues/tecinco-invoice.queue";
import type { Requester } from "../../../middlewares/auth-token";
import type { JobStatus } from "../../../shared/utils/queues/job-status";

// Uma entidade por import.
export const MANUAL_IMPORT_ENTITIES = ["product", "invoice", "order"] as const;
export type ManualImportEntity = (typeof MANUAL_IMPORT_ENTITIES)[number];

// Tipos de busca; quais valem pra cada integração/entidade é o handler que diz.
export const MANUAL_IMPORT_SEARCH_BY = [
  "id",
  "name",
  "number",
  "access_key",
  "local_id",
] as const;
export type ManualImportSearchBy = (typeof MANUAL_IMPORT_SEARCH_BY)[number];
// local_id é resolvido pra uma dessas antes de chamar a API.
export type ManualImportExternalSearchBy = Exclude<ManualImportSearchBy, "local_id">;

// Body do POST /manual-import.
export interface ManualImportSearchRequest {
  integrationId: string;
  entity: ManualImportEntity;
  by: ManualImportSearchBy;
  value: string;
}

// Body do POST /manual-import/confirm.
export interface ManualImportConfirmRequest {
  integrationId: string;
  entity: ManualImportEntity;
  externalIds: string[];
}

// Filas usadas pelos handlers, vindas de req.app.locals.
export interface ManualImportQueues {
  blingApiFetch: BlingApiFetchQueue;
  blingOrder: BlingOrderQueue;
  tcarApiFetch: TCarUpsertQueue;
  tcarInvoice: TCarInvoiceQueue;
}
export type ManualImportQueueKey = keyof ManualImportQueues;

// Onde achar o job de um item pra calcular o andamento.
export interface ManualImportJobRef {
  queue: ManualImportQueueKey;
  jobId: string;
}

// Dados de exibição por entidade na lista da busca.
export interface ManualImportProductDetails {
  name: string | null;
  ean: string | null;
  code: string | null;
  status: string | null;
}

export interface ManualImportInvoiceDetails {
  number: string | null;
  series: string | null;
  model: "NF-e" | "NFC-e" | null;
  type: "IN" | "OUT" | null;
  issuedAt: string | null;
  contact: string | null;
  status: string | null;
}

export interface ManualImportOrderDetails {
  number: string | null;
  storeNumber: string | null;
  date: string | null;
  contact: string | null;
  status: string | null;
}

export type ManualImportDetails =
  | ManualImportProductDetails
  | ManualImportInvoiceDetails
  | ManualImportOrderDetails;

// Resultado cru do handler; enqueueData é o que o job precisa e vai pro cache da busca.
export interface ManualImportFoundItem {
  externalId: string;
  label: string;
  details: ManualImportDetails;
  importable: boolean;
  reason?: string;
  enqueueData: unknown;
}

// Retorno de handler.search: truncated = a listagem tinha mais que a 1ª página.
export interface ManualImportSearchOutput {
  items: ManualImportFoundItem[];
  truncated: boolean;
}

// Quem já está importando o item (outro usuário/application).
export interface ManualImportProcessingBy extends Requester {
  name: string | null;
}

// Registro do cache da busca no Redis — o confirm só enfileira o que está aqui.
export interface ManualImportSavedItem {
  externalId: string;
  label: string;
  importable: boolean;
  reason?: string;
  existsLocally: boolean;
  localId: string | null;
  enqueueData: unknown;
}

// Item da lista devolvida no outcome CHOOSE.
export interface ManualImportSearchResult {
  externalId: string;
  label: string;
  details: ManualImportDetails;
  importable: boolean;
  reason?: string;
  existsLocally: boolean;
  localId: string | null;
  alreadyProcessing: ManualImportProcessingBy | null;
}

// Aviso não bloqueante devolvido junto da resposta.
export interface ManualImportWarning {
  code: "ALREADY_EXISTS_UPDATING" | "OTHER_MANUAL_IMPORTS_RUNNING";
  message: string;
}

// Resultado de cada item na hora de enfileirar.
export type ManualImportItemOutcome =
  | "ENQUEUED"
  | "SEARCH_EXPIRED"
  | "NOT_IMPORTABLE"
  | "ALREADY_PROCESSING"
  | "ENQUEUE_FAILED";

export interface ManualImportItemResult {
  externalId: string;
  label: string | null;
  status: ManualImportItemOutcome;
  reason?: string;
  processingBy?: ManualImportProcessingBy;
  warnings: ManualImportWarning[];
}

// Valor do claim de um item no Redis (trava global por integração).
export interface ManualImportItemClaim {
  runId: string;
  requestedBy: Requester;
  jobRef: ManualImportJobRef;
}

export type ManualImportRunStatus = "RUNNING" | "FINISHED";

// status/error/result só são gravados no snapshot final (FINISHED).
export interface ManualImportRunItem {
  externalId: string;
  label: string;
  existsLocally: boolean;
  jobRef: ManualImportJobRef;
  status?: JobStatus;
  error?: string;
  result?: string;
}

// Registro do import do usuário guardado no Redis.
export interface ManualImportRun {
  runId: string;
  status: ManualImportRunStatus;
  integrationId: string;
  entity: ManualImportEntity;
  requestedBy: Requester;
  startedAt: string;
  finishedAt?: string;
  items: ManualImportRunItem[];
}

// Andamento devolvido pro front: done = completed + failed.
export interface ManualImportRunView {
  runId: string;
  status: ManualImportRunStatus;
  integrationId: string;
  entity: ManualImportEntity;
  total: number;
  done: number;
  completed: number;
  failed: number;
  startedAt: string;
  finishedAt?: string;
  items: Array<{
    externalId: string;
    label: string;
    existsLocally: boolean;
    status: JobStatus;
    error?: string;
    result?: string;
  }>;
}

// Resposta do GET /manual-import/status.
export interface ManualImportStatusResponse {
  run: ManualImportRunView | null;
  othersRunning: Record<string, boolean>;
  maxItems: number;
}

// Resposta dos POSTs: o controller só repassa status + body.
export interface ManualImportResponse {
  httpStatus: number;
  body: Record<string, unknown>;
}

// Contrato que toda integração implementa (um handler por provider).
export interface ManualImportHandler {
  getIntegration(): Promise<{ id: string }>;
  supportedSearches: Partial<
    Record<ManualImportEntity, ManualImportExternalSearchBy[]>
  >;
  // Busca usada pra refazer o fetch de um registro local (by: "local_id").
  localIdSearchBy: Partial<
    Record<ManualImportEntity, ManualImportExternalSearchBy>
  >;
  // Filas onde o aviso de outro import manual procura jobs pendentes.
  queueKeys: ManualImportQueueKey[];
  queueFor(entity: ManualImportEntity): ManualImportQueueKey;
  search(
    entity: ManualImportEntity,
    by: ManualImportExternalSearchBy,
    value: string,
  ): Promise<ManualImportSearchOutput>;
  // externalId → id local, numa consulta só.
  findLocalIds(
    entity: ManualImportEntity,
    externalIds: string[],
  ): Promise<Map<string, string>>;
  // null quando o registro não existe ou não está vinculado à integração.
  findExternalIdByLocalId(
    entity: ManualImportEntity,
    localId: string,
  ): Promise<string | null>;
  enqueue(
    entity: ManualImportEntity,
    item: ManualImportSavedItem,
    jobRef: ManualImportJobRef,
    queues: ManualImportQueues,
  ): Promise<void>;
}
