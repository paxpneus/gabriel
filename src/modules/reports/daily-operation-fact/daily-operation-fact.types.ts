import { Optional } from "sequelize";

export interface DailyOperationFactAttributes {
  id: string;
  fact_date: string;
  unit_business_id: string;
  invoices_incoming_count?: number;
  invoices_outgoing_count?: number;
  volumes_received?: number;
  volumes_dispatched?: number;
  invoices_incoming_total?: number;
  invoices_outgoing_total?: number;
  invoices_incoming_fully_processed?: number;
  invoices_outgoing_fully_processed?: number;
  outgoing_perf_avg_minutes?: number | string | null;
  outgoing_perf_min_minutes?: number | string | null;
  outgoing_perf_max_minutes?: number | string | null;
  outgoing_perf_invoice_count?: number;
  incoming_perf_avg_minutes?: number | string | null;
  incoming_perf_min_minutes?: number | string | null;
  incoming_perf_max_minutes?: number | string | null;
  incoming_perf_invoice_count?: number;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailyOperationFactCreationAttributes = Optional<
  DailyOperationFactAttributes,
  | "id"
  | "invoices_incoming_count"
  | "invoices_outgoing_count"
  | "volumes_received"
  | "volumes_dispatched"
  | "invoices_incoming_total"
  | "invoices_outgoing_total"
  | "invoices_incoming_fully_processed"
  | "invoices_outgoing_fully_processed"
  | "outgoing_perf_avg_minutes"
  | "outgoing_perf_min_minutes"
  | "outgoing_perf_max_minutes"
  | "outgoing_perf_invoice_count"
  | "incoming_perf_avg_minutes"
  | "incoming_perf_min_minutes"
  | "incoming_perf_max_minutes"
  | "incoming_perf_invoice_count"
  | "last_updated_at"
  | "createdAt"
  | "updatedAt"
>;
