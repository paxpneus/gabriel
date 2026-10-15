import { BlingApiFetchQueue } from "../bling/queues/bling-api-fetch.queue";
import { BlingOrderQueue } from "../bling-orders/bling-order.queue";

export const POPULATE_ENTITIES = ["products", "invoices", "orders"] as const;
export type PopulateEntity = (typeof POPULATE_ENTITIES)[number];

export const INVOICE_STEPS = [
  "nfe_out",
  "nfe_in",
  "nfe_cancelled",
  "nfce",
] as const;
export type InvoiceStep = (typeof INVOICE_STEPS)[number];

export type PopulateStep = "products" | InvoiceStep | "orders";

export interface PopulateRequest {
  entities: PopulateEntity[];
  invoiceTypes?: InvoiceStep[];
  // normalized_status (mesmo vocabulário de filters[status] do GET /order).
  orderStatus?: string[];
  limit?: number;
}

export interface BlingSyncQueues {
  apiFetchQueue: BlingApiFetchQueue;
  orderQueue: BlingOrderQueue;
}

export type PopulateRunStatus = "RUNNING" | "FINISHED" | "FAILED";

export interface PopulateStepResult {
  step: PopulateStep;
  enqueued: number;
  skipped: number;
  finishedAt?: string;
}

export interface PopulateRun {
  runId: string;
  status: PopulateRunStatus;
  steps: PopulateStep[];
  limit: number | null;
  orderSituationIds: number[] | null;
  requestedBy: { id: string; type: "user" | "application" };
  currentStep: PopulateStep | null;
  results: PopulateStepResult[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
}
