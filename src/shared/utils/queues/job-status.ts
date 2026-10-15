import { Job } from "bullmq";

// Estado de job normalizado pro front (polling de criação de produto e import manual).
export type JobStatus =
  | "not_found"
  | "waiting"
  | "active"
  | "delayed"
  | "completed"
  | "failed"
  | "unknown";

// Estados em que o job não muda mais — not_found inclusive (já removido do Redis).
export const FINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  "completed",
  "failed",
  "not_found",
]);

// returnvalue de job de import — quem não devolve nada completa como IMPORTED.
export const IMPORT_JOB_RESULT = {
  IMPORTED: "IMPORTED",
  IGNORED_NO_TIRE_ITEMS: "IGNORED_NO_TIRE_ITEMS",
} as const;
export type ImportJobResult =
  (typeof IMPORT_JOB_RESULT)[keyof typeof IMPORT_JOB_RESULT];

// "prioritized" é o estado BullMQ de job com priority ainda não pego por worker — pro front é "waiting".
export async function toJobStatus(
  job: Job | null | undefined,
): Promise<{ status: JobStatus; error?: string }> {
  if (!job) return { status: "not_found" };

  const state = await job.getState();

  if (state === "failed") return { status: "failed", error: job.failedReason };
  if (state === "prioritized") return { status: "waiting" };
  if (
    state === "waiting" ||
    state === "active" ||
    state === "delayed" ||
    state === "completed"
  ) {
    return { status: state };
  }

  return { status: "unknown" };
}
