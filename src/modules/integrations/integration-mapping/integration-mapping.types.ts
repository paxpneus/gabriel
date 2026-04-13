export type EntityType = 'PRODUCT' | 'INVOICE';

export interface IntegrationMappingAttributes {
  id: string;
  entity_type: EntityType;
  internal_id: string;
  integrations_id: string;
  external_id: string;
  unit_business_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IntegrationMappingCreationAttributes extends Omit<IntegrationMappingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
