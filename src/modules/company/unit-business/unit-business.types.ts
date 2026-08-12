import { UnitBusinessConfigAttributes } from "./unit-business-config/unit-business-config.types";

export interface UnitBusinessAttributes {
  id: string;
  number: string;
  name: string;
  cnpj: string;
  integrations_id?: string;
  id_system: string;
  head_office: boolean;
  transshipment_allowed?: boolean;
  certificate_path?: string;
  certificate_password?: string;
  ult_nsu?: string;
  emails?: string[] | null;
  type?: string;
  config?: UnitBusinessConfigAttributes | null
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UnitBusinessCreationAttributes extends Omit<UnitBusinessAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
