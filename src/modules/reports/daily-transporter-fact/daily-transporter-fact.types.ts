import { Optional } from "sequelize";

export interface DailyTransporterFactAttributes {
  id: string;
  fact_date: string;
  unit_business_id: string;
  transporter_id: string;
  volumes_dispatched?: number;
  invoices_count?: number;
  invoices_fully_processed?: number;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailyTransporterFactCreationAttributes = Optional<
  DailyTransporterFactAttributes,
  | "id"
  | "volumes_dispatched"
  | "invoices_count"
  | "invoices_fully_processed"
  | "last_updated_at"
  | "createdAt"
  | "updatedAt"
>;
