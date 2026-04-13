export interface EntranceScanLogAttributes {
  id: string;
  invoice_items_id: string;
  label_full_code: string;
  vol_number: string;
  user_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EntranceScanLogCreationAttributes extends Omit<EntranceScanLogAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
