export interface TransporterAttributes {
  id: string;
  name: string;
  cnpj: string;
  city: string;
  uf: string;
  id_system: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TransporterCreationAttributes extends Omit<TransporterAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
