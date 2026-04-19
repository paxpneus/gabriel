import { Product } from "../../../inventory";
import ExpeditionBatchItems from "./batch-items.model";

export interface ExpeditionBatchItemsAttributes {
  id: string;
  expedition_batch_id: string;
  product_id: string;
  quantity: number;
  quantity_scanned: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ExpeditionBaatchItemFull extends ExpeditionBatchItems {
  product: Product
}

export interface ExpeditionBatchItemsCreationAttributes extends Omit<ExpeditionBatchItemsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
