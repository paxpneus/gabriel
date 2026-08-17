export const QUEUE_NAMES = {
  BLING_API_FETCH: "BLING_API_FETCH",
  // BLING_ORDER: "BLING_ORDER",
  // CNPJ: "CNPJ",
  // NFE: "NFE",
  // ML_ORDER_SYNC: "ML_ORDER_SYNC",
  // BLING_DIRECT_UPSERT: "BLING_DIRECT_UPSERT",
  // BLING_TOKEN_REFRESH: "BLING_TOKEN_REFRESH",
  // BLING_MIGRATION: "BLING_MIGRATION",
  // TCAR_MIGRATION: "TCAR_MIGRATION",
  // TCAR_UPSERT: "TCAR_UPSERT",
  // DAILY_OPERATION_REPORT: "DAILY_OPERATION_REPORT",
  // DAILY_SALES_REPORT: "DAILY_SALES_REPORT",
  // AUTO_BACKUP: "AUTO_BACKUP",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Subconjunto de estados que a API do BullMQ aceita em getJobCounts/getJobs/clean
export type QueueJobStatus =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "paused"
  | "waiting-children"
  | "prioritized";

export const ALL_STATUSES: QueueJobStatus[] = [
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
  "paused",
  "waiting-children",
  "prioritized"
];

export interface QueueJobSummary {
  id: string | undefined;
  name: string;
  data: unknown;
  status: string;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
}

export interface QueueOverview {
  name: string;
  isPaused: boolean;
  counts: Record<string, number>;
}