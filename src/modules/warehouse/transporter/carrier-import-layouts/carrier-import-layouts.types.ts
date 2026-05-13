export type CarrierImportLayoutType = "EXCEL" | "CSV";
export type CarrierImportLayoutMappingMode = "HEADER" | "COLUMN";

export interface CarrierImportLayoutAttributes {
  id: string;
  transporter_id: string;
  name: string;
  type: CarrierImportLayoutType;
  sheet_name?: string | null;
  data_start_row: number;
  mapping_mode: CarrierImportLayoutMappingMode;
  zip_from_label: string;
  zip_to_label: string;
  route_code_label?: string | null;
  destination_label?: string | null;
  observation_label?: string | null;
  metadata?: Record<string, any> | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CarrierImportLayoutCreationAttributes
  extends Omit<CarrierImportLayoutAttributes, "id" | "createdAt" | "updatedAt"> {}
