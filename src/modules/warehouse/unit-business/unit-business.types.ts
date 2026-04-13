export interface UnitBusinessAttributes {
  id: string;
  number: string;
  name: string;
  cnpj: string;
  integrations_id?: string;
  head_office: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UnitBusinessCreationAttributes extends Omit<UnitBusinessAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
