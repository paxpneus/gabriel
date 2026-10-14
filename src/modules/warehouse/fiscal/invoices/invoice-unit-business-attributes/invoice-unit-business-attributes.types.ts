export type InvoiceUnitBusinessAttributesStatus =
  | "OPEN"
  | "PENDING"
  | "FINISHED"
  | "CANCELLED"
  | "FREE_TO_SCHEDULE"
  | "WAITING_SCHEDULE_SALES"
  | "SCHEDULED"
  | "LATE";

export interface InvoiceUnitBusinessAttributesAttributes {
  id: string;
  unit_business_id: string;
  invoice_id: string;
  type: "INCOMING" | "OUTGOING";
  status: InvoiceUnitBusinessAttributesStatus;
  batch_generated?: boolean;
  danfe_printed?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceUnitBusinessAttributesCreationAttributes extends Omit<
  InvoiceUnitBusinessAttributesAttributes,
  "id" | "createdAt" | "updatedAt"
> {}
