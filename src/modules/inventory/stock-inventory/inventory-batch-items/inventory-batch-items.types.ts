import Product from "../../products/product.model";
import { ProductWithStock } from "../../products/product.types";

export type ItemStatus = 'FINISHED' | 'PENDING' | 'OPEN';

export interface InventoryBatchItemsAttributes {
    id: string;
    product_id: string;
    ean: string;
    sku: string;
    quantity_stock: number;
    quantity_read: number;
    divergency: number;
    status: ItemStatus;
    stock_id: string;
    inventory_batch_id: string
    price?: number;
    initial_divergency?: number
}
export interface inventoryBatchItemFull extends InventoryBatchItemsAttributes {
    product: ProductWithStock
}

export type InventoryBatchItemsCreationAttributes = Omit<InventoryBatchItemsAttributes, 'id'>;

export type Operation = 'INCREMENT' | 'DECREMENT'