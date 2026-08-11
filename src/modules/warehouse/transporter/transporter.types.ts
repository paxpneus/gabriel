export interface TransporterAttributes {
  id: string;
  name: string;
  cnpj?: string | null;
  city?: string | null;
  uf?: string | null;
  id_system?: string | null;
  integrations_id?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TransporterCreationAttributes extends Omit<TransporterAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
