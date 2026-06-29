import { Product } from "../../../inventory";
import { ProductAttributes } from "../../../inventory/products/product.types";
import ExpeditionBatchItems from "./batch-items.model";

export interface ExpeditionBatchItemsAttributes {
  id: string;
  expedition_batch_id: string;
  product_id: string;
  quantity: number;
  quantity_scanned: number;
  createdAt?: Date;
  updatedAt?: Date;

  product?: ProductAttributes

}

export interface ExpeditionBaatchItemFull extends ExpeditionBatchItems {
  product: ProductAttributes
}

export interface ExpeditionBatchItemsCreationAttributes extends Omit<ExpeditionBatchItemsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
