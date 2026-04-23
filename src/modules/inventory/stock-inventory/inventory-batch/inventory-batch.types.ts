export interface InventoryBatchAttributes {
    id: string;
    date: Date;
    total_quantity_stock: number;
    total_quantity_read: number;
    number: string;
    unit_business_id: string;
}

export type InventoryBatchCreationAttributes = Omit<InventoryBatchAttributes, 'id'>;