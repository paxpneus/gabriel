export interface ProductStockFlowParams {
  startDate: string;
  endDate: string;
  // Filtra por products.brand (texto); ausente = todas as marcas.
  brands?: string[];
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

export interface ProductStockFlowReturnRow {
  month: string;
  product_id: string;
  total_return_quantity: string | null;
  total_return_value: string | null;
  returns_without_price: string | number;
}

export interface ProductStockFlowProduct {
  product_id: string;
  product_name: string | null;
  sku: string | null;
  // products.brand (texto), o mesmo campo usado pelo filtro `brand`.
  brand: string | null;
  total_input_quantity: number;
  total_input_value: number;
  total_output_quantity: number;
  total_output_value: number;
  total_return_quantity: number;
  total_return_value: number;
}

export interface ProductStockFlowSummary {
  total_input_quantity: number;
  total_output_quantity: number;
  total_return_quantity: number;
  total_input_value: number;
  total_output_value: number;
  total_return_value: number;
}

export interface ProductStockFlowReport {
  filters: {
    store_id: number;
    unit_business_id: string;
    start_date: string;
    end_date: string;
    brand: string[] | null;
  };
  months: { month: string; products: ProductStockFlowProduct[] }[];
  consolidated: ProductStockFlowProduct[];
  summary: ProductStockFlowSummary;
  warnings: {
    outputs_without_price: number;
    inputs_without_net_amount: number;
    returns_without_price: number;
  };
}
