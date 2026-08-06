export type StockMovementType =
  | "PURCHASE_ENTRY"
  | "SALE_OUT"
  | "CUSTOMER_RETURN"
  | "MANUAL_ADJUSTMENT";

export type StockDirectionType = "IN" | "OUT"

export type StockMovementStatus = "PENDING" | "SYNCHED";


export interface StockMovementAttributes {
  id?: string;
  unit_business_id: string;
  product_id: string;
  invoice_id: string | null;
  invoice_number?: string;
  direction?: StockDirectionType;
  movement_type: StockMovementType;
  movement_date: Date;
  movement_quantity: number;
  unit_cost_invoice?: number;
  balance_quantity: number;
  resulting_average_cost: number;
  total_stock_value: number;
  manual_average_cost_value?: number | null;
  is_active: Boolean; 
  status: StockMovementStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ListSourceDataFromInvoices extends Pick<
  StockMovementAttributes,
  | "product_id"
  | "movement_quantity"
  | "movement_date"
  | "invoice_id"
  | "invoice_number"
  | "manual_average_cost_value"
> {
  movement_type: StockMovementType;
  unit_cost_invoice: number;
}

export interface ReindexProductPayload extends Pick<
  StockMovementAttributes,
  | "product_id"
  | "movement_type"
  | "movement_quantity"
  | "unit_cost_invoice"
  | "movement_date"
  | "invoice_id"
  | "invoice_number"
  | "manual_average_cost_value"
  | "direction"
> {}

export interface StockMovementCreationAttributes extends Omit<
  StockMovementAttributes,
  "id" | "createdAt" | "updatedAt"
> {}
