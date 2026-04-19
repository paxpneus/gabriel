
export interface ExpeditionScanLogAttributes {
  id: string;
  expedition_batch_items_id: string;
  label_full_code: string;
  vol_number: string;
  user_id: string;
  expedition_batch_invoices_id?: string;
  expedition_batch_id?: string
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ExpeditionScanLogCreationAttributes extends Omit<ExpeditionScanLogAttributes, 'id' | 'createdAt' | 'updatedAt'> {}


