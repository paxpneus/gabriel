export interface IntegrationOrderStatusMappingAttributes {
  id: string;
  integration_id: string;
  external_status_id: string;
  external_status_value?: string | null;
  normalized_status: string;
  display_name: string;
  is_cancelled?: boolean;
  is_final?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IntegrationOrderStatusMappingCreationAttributes = Omit<
  IntegrationOrderStatusMappingAttributes,
  "id" | "createdAt" | "updatedAt"
>;