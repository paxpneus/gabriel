export const ENTITY_TYPES = ["PRODUCT", "INVOICE", "CONTACT"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface IntegrationMappingAttributes {
  id: string;
  entity_type: EntityType;
  internal_id: string;
  integrations_id: string;
  external_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IntegrationMappingCreationAttributes extends Omit<IntegrationMappingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export interface GroupedIntegrationMapping {
  integration_name: string;
  integration_id: string;
}
