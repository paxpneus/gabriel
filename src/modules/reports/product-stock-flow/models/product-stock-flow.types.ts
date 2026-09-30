export interface ProductStockFlowParams {
  startDate: string;
  endDate: string;
}

export interface ProductStockFlowInputRow {
  month: string;
  product_id: string;
  total_input_quantity: string | null;
  total_input_value: string | null;
  inputs_without_net_amount: string | number;
}

export interface ProductStockFlowOutputRow {
  month: string;
  product_id: string;
  total_output_quantity: string | null;
  total_output_value: string | null;
  outputs_without_price: string | number;
}

export interface ProductStockFlowProduct {
  product_id: string;
  product_name: string | null;
  sku: string | null;
  total_input_quantity: number;
  total_input_value: number;
  total_output_quantity: number;
  total_output_value: number;
}

export interface ProductStockFlowSummary {
  total_input_quantity: number;
  total_output_quantity: number;
  total_input_value: number;
  total_output_value: number;
}

export interface ProductStockFlowReport {
  filters: {
    store_id: number;
    unit_business_id: string;
    start_date: string;
    end_date: string;
  };
  months: { month: string; products: ProductStockFlowProduct[] }[];
  consolidated: ProductStockFlowProduct[];
  summary: ProductStockFlowSummary;
  warnings: {
    outputs_without_price: number;
    inputs_without_net_amount: number;
  };
}
