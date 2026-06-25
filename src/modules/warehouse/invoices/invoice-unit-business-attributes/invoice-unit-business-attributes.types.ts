export type InvoiceUnitBusinessAttributesStatus =
  | "OPEN"
  | "PENDING"
  | "FINISHED"
  | "CANCELLED"
  | "FREE_TO_SCHEDULE"
  | "WAITING_SCHEDULE_SALES"
  | "SCHEDULED"
  | "LATE"
  | "PENDING_CANCELLED_SYSTEM";

export interface InvoiceUnitBusinessAttributesAttributes {
  id: string;
  unit_business_id: string;
  invoice_id: string;
  type: "INCOMING" | "OUTGOING";
  status: InvoiceUnitBusinessAttributesStatus;
  batch_generated?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceUnitBusinessAttributesCreationAttributes extends Omit<
  InvoiceUnitBusinessAttributesAttributes,
  "id" | "createdAt" | "updatedAt"
> {}
