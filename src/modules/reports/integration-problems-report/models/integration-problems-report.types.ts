export interface IntegrationProblemsReportParams {
  startDate: string;
  endDate: string;
}

/** Problemas de nota fiscal × Kardex do CD21 (saídas e devoluções). */
export type IntegrationProblemType =
  | "sale_movement_without_invoice"
  | "sale_invoice_without_movement"
  | "cancelled_invoice_return_without_movement"
  | "cancelled_invoice_without_return"
  | "sale_invoice_without_order"
  | "return_movement_without_invoice"
  | "return_invoice_without_movement";

export interface IntegrationProblemRow {
  problem: IntegrationProblemType;
  // Texto pro usuário leigo explicando o problema.
  description: string;
  invoice_number: string | null;
  // Data do movimento no Kardex; nota sem movimento usa a emissão.
  date: string | null;
  order_number: string | null;
  // NF de devolução da nota cancelada (só cancelled_invoice_return_without_movement).
  return_invoice_number: string | null;
}

/** Uma linha por nota dos movimentos de saída do CD21 (ajuste do CSV = pedido), com o pedido e a devolução da cancelada. */
export interface SaleMovementInvoiceRow {
  invoice_id: string | null;
  invoice_number: string | null;
  is_order_adjustment: boolean;
  movement_date: string;
  invoice_cancelled: boolean;
  // Cancelada com NF de devolução no sistema (movimentada ou não).
  has_return_invoice: boolean;
  return_invoice_number: string | null;
  // Cancelada com NF de devolução movimentada no Kardex: saída já estornada, não é problema.
  has_return: boolean;
  order_id: string | null;
  order_number: string | null;
}

/** Nota de saída do CD21 não cancelada emitida no período sem movimento de venda. */
export interface SaleInvoiceWithoutMovementRow {
  invoice_number: string | null;
  emitted_date: string | null;
  order_number: string | null;
}

export interface IntegrationProblemsReport {
  filters: {
    start_date: string;
    end_date: string;
    unit_business_id: string;
  };
  rows: IntegrationProblemRow[];
  summary: Record<IntegrationProblemType, number> & { total: number };
}
