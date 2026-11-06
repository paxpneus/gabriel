import { EntityType } from "../integration-mapping/integration-mapping.types";

// Valor que a integração mandou sem integration_mapping (ex.: forma de pagamento nova da Bling).
// entity usa o mesmo vocabulário de integration_mappings.entity_type: mapear cria o mapping desse tipo.
export interface UnmappedEntityAttributes {
  id: string;
  entity: EntityType;
  external_id: string;
  integrations_id: string;
  description: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UnmappedEntityCreationAttributes = Omit<
  UnmappedEntityAttributes,
  "id" | "createdAt" | "updatedAt"
>;
