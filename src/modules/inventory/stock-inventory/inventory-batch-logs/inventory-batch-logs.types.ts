export interface InventoryBatchLogsAttributes {
    id: string;
    user_id: string;
    quantity_read: number;
    inventory_batch_item_id: string;
    label_code: string;
    date: Date;
}

export type InventoryBatchLogsCreationAttributes = Omit<InventoryBatchLogsAttributes, 'id'>;