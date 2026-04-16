export interface SupplierAttributes {
  id: string;
  name: string;
  document: string;
  fantasy_name?: string | null;
  city: string;
  uf: string;
  id_system: string;
  code: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupplierCreationAttributes extends Omit<SupplierAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
