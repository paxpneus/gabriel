export interface ExternalOrderStatusMappingAttributes {
  id: string;
  integration_id?: string | null;
  source_system?: string | null;
  external_status_id: string;
  external_status_value?: string | null;
  normalized_status: string;
  display_name: string;
  is_cancelled?: boolean;
  is_final?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ExternalOrderStatusMappingCreationAttributes = Omit<
  ExternalOrderStatusMappingAttributes,
  "id" | "createdAt" | "updatedAt"
>;
