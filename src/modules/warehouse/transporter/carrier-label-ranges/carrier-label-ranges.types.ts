export interface CarrierLabelRangeAttributes {
  id: string;
  transporter_id: string;
  cep_start: string;
  cep_end: string;
  route_acronym: string | null;
  destination?: string | null;
  route_code?: string | null;
  transporter_code: string;
  metadata?: Record<string, any> | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CarrierLabelRangeCreationAttributes
  extends Omit<CarrierLabelRangeAttributes, "id" | "createdAt" | "updatedAt"> {}
