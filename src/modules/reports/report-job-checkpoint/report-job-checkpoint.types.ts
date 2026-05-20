import { Optional } from "sequelize";

export type ReportJobCheckpointStatus = "success" | "running" | "failed";

export interface ReportJobCheckpointAttributes {
  id: string;
  job_name: string;
  last_processed_at: Date;
  last_run_at: Date;
  status: ReportJobCheckpointStatus;
  rows_processed?: number;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ReportJobCheckpointCreationAttributes = Optional<
  ReportJobCheckpointAttributes,
  "id" | "last_run_at" | "status" | "rows_processed" | "metadata" | "createdAt" | "updatedAt"
>;
