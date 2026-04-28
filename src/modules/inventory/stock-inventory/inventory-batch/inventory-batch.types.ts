export interface InventoryBatchAttributes {
    id: string;
    status: string;
    date: Date;
    total_quantity_stock: number;
    total_quantity_read: number;
    number: string;
    unit_business_id: string;
    type: string;
    BatchIdForDivergency?: string;
}

export type InventoryBatchCreationAttributes = Omit<InventoryBatchAttributes, 'id'>;