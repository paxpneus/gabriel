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
    // valor do estoque do item na entrada no lote (unit_price × quantity_stock), não muda na bipagem
    price?: number;
    // preço de venda e custo médio congelados na entrada do item no lote
    unit_price?: number | null;
    average_cost?: number | null;
    initial_divergency?: number
    // Cópia só leitura do Stock na criação do item; não entra em cálculo.
    reserved_quantity?: number | null;
    virtual_stock?: number | null;
}
export interface inventoryBatchItemFull extends InventoryBatchItemsAttributes {
    product: ProductWithStock
}

export type InventoryBatchItemsCreationAttributes = Omit<InventoryBatchItemsAttributes, 'id'>;

export type Operation = 'INCREMENT' | 'DECREMENT'