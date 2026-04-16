export interface ExpeditionBatchAttributes {
  id: string;
  number: string;
  status: 'OPEN' | 'PENDING' | 'FINISHED';
  integrations_id?: string;
  id_system?: string;
  unit_business_id: string;
  total_volumes: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ExpeditionBatchCreationAttributes extends Omit<ExpeditionBatchAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
