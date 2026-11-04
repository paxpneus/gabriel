export interface SalesReturnReportParams {
  startDate: string;
  endDate: string;
  // products.brand (texto, mesmo filtro do stock flow); ausente = todas.
  brands?: string[];
  productIds?: string[];
}

type DecimalValue = string | number | null;

/** Linha crua do repository: movimento CUSTOMER_RETURN (qtd e valor do lançamento Bling) + nota/venda/pedido de origem. */
export interface SalesReturnLineRow {
  movement_id: string;
  return_invoice_id: string | null;
  return_invoice_number: string | null;
  return_date: string | null;
  sku: string | null;
  description: string | null;
  quantity: DecimalValue;
  total_value: DecimalValue;
  has_price: boolean;
  product_name: string | null;
  brand: string | null;
  sale_invoice_number: string | null;
  order_id: string | null;
  order_number_system: string | null;
  order_date: string | null;
  store_name: string | null;
  seller_name: string | null;
  customer_name: string | null;
  sales_channel: string | null;
}

/** Nota candidata a devolução sem movimento; xml_head = início do xml_path (finNFe conferido na service). */
export interface ReturnInvoiceCandidateRow {
  invoice_number: string | null;
  emitted_date: string | null;
  xml_head: string | null;
}

export interface SalesReturnReportRow {
  movement_id: string;
  return_invoice_id: string | null;
  return_invoice_number: string | null;
  return_date: string | null;
  order_id: string | null;
  store_name: string | null;
  order_date: string | null;
  order_number: string | null;
  seller_name: string | null;
  customer_name: string | null;
  sales_channel: string | null;
  invoice_number: string | null;
  brand: string | null;
  product: string | null;
  sku: string | null;
  quantity: number;
  total_value: number;
  order_total_value: number;
  volumes: number;
  has_price: boolean;
}

export interface SalesReturnReportSummary {
  orders_count: number;
  items_quantity: number;
  total_volumes: number;
  gross_revenue: number;
  lines_without_price: number;
}

export interface SalesReturnReport {
  filters: {
    start_date: string;
    end_date: string;
    unit_business_id: string;
    brand: string[] | null;
    product_id: string[] | null;
  };
  rows: SalesReturnReportRow[];
  summary: SalesReturnReportSummary;
  // Só contagem; o detalhe fica no relatório de problemas de integração.
  warnings: {
    // Notas dos movimentos de devolução que não existem no sistema.
    movements_without_invoice: number;
    // NF de devolução não cancelada emitida no período sem movimento de estoque.
    invoices_without_movement: number;
  };
}

/** Devoluções do Kardex do CD21 no período e NF de devolução sem movimento: base do relatório e dos problemas de integração. */
export interface SalesReturnData {
  unitBusinessId: string;
  lines: SalesReturnLineRow[];
  invoicesWithoutMovement: ReturnInvoiceCandidateRow[];
}
