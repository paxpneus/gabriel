export interface ExpeditionBatchItemsAttributes {
  id: string;
  expedition_batch_id: string;
  product_id: string;
  quantity: number;
  quantity_scanned: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ExpeditionBatchItemsCreationAttributes extends Omit<ExpeditionBatchItemsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
