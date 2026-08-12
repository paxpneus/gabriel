import { redisConnection } from "../../../../../../shared/utils/base-models/base-redis";

export type JobStatus = "queued" | "processing" | "done" | "error";

export interface JobState {
  status: JobStatus;
  total: number;
  processed: number;
  filePath?: string; 
  error?: string;
}

const key = (jobId: string) => `cte-xml-job:${jobId}`;

export const JobTracker = {
  async init(jobId: string, total: number) {
    await redisConnection.set(
      key(jobId),
      JSON.stringify({ status: "queued", total, processed: 0 } as JobState),
      "EX",
      3600,
    );
  },

  async update(jobId: string, patch: Partial<JobState>) {
    const current = await this.get(jobId);
    const next = { ...current, ...patch };
    await redisConnection.set(key(jobId), JSON.stringify(next), "EX", 3600);
    return next;
  },

  async get(jobId: string): Promise<JobState | null> {
    const raw = await redisConnection.get(key(jobId));
    return raw ? JSON.parse(raw) : null;
  },
};