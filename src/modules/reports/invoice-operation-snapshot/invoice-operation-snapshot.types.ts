import { Optional } from "sequelize";

export type InvoiceOperationSnapshotType = "INCOMING" | "OUTGOING";
export type InvoiceOperationSnapshotStatus = "open" | "completed" | "cancelled" | "pending_cancelled";

export interface InvoiceOperationSnapshotAttributes {
  id: string;
  invoice_id: string;
  unit_business_id: string;
  transporter_id?: string | null;
  type: InvoiceOperationSnapshotType;
  invoice_date?: string | null;
  emitted_at?: Date | null;
  delivery_note_generated_at?: Date | null;
  first_scan_at?: Date | null;
  last_scan_at?: Date | null;
  fully_processed_at?: Date | null;
  total_items_expected?: number;
  total_items_received?: number;
  scan_completion_pct?: number | string;
  hours_emission_to_delivery_note?: number | string | null;
  hours_batch_to_fully_scanned?: number | string | null;
  is_supplier_return?: boolean;
  snapshot_status?: InvoiceOperationSnapshotStatus;
  is_advance_payment?: boolean;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type InvoiceOperationSnapshotCreationAttributes = Optional<
  InvoiceOperationSnapshotAttributes,
  | "id"
  | "transporter_id"
  | "invoice_date"
  | "emitted_at"
  | "delivery_note_generated_at"
  | "first_scan_at"
  | "last_scan_at"
  | "fully_processed_at"
  | "total_items_expected"
  | "total_items_received"
  | "scan_completion_pct"
  | "hours_emission_to_delivery_note"
  | "hours_batch_to_fully_scanned"
  | "is_supplier_return"
  | "snapshot_status"
  | "last_updated_at"
  | "createdAt"
  | "updatedAt"
>;
