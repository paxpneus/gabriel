export type StockMovementType = 'PURCHASE_ENTRY' | 'SALE_OUT' | 'CUSTOMER_RETURN';

export interface StockMovementAttributes {
  id?: string;
  unit_business_id: string;
  product_id: string;
  invoice_id: string;
  invoice_number?: string;
  movement_type: StockMovementType;
  movement_date: Date;
  movement_quantity: number;
  unit_cost_invoice?: number;
  balance_quantity: number;
  resulting_average_cost: number;
  total_stock_value: number;
  manual_discount_value?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ListSourceDataFromInvoices
  extends Pick<
    StockMovementAttributes,
    | 'product_id'
    | 'movement_quantity'
    | 'movement_date'
    | 'invoice_id'
    | 'invoice_number'
  > {

  movement_type: StockMovementType;
  unit_cost_invoice: number;
}

export interface ReindexProductPayload
  extends Pick<
    StockMovementAttributes,
    | 'product_id'
    | 'movement_type'
    | 'movement_quantity'
    | 'unit_cost_invoice'
    | 'movement_date'
    | 'invoice_id'
    | 'invoice_number'
  > {}


export interface StockMovementCreationAttributes
  extends Omit<StockMovementAttributes, 'id' | 'createdAt' | 'updatedAt'> {}