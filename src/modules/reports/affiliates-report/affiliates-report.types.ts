// Filtros do relatório de afiliados do hub (período pela data do pedido; afiliado opcional, um ou vários).
export interface AffiliatesReportParams {
  startDate: string;
  endDate: string;
  affiliatedIds?: string[];
}

// Linha do repository: um afiliado com as vendas do período já somadas no SQL (Postgres devolve numeric como string).
export interface AffiliatesReportRow {
  affiliated_id: string;
  affiliated_name: string | null;
  coupon_codes: string | null;
  sales_count: number | string;
  items_sold_count: number | string;
  total_sold: number | string;
  profit: number | string;
  affiliated_comission: number | string;
  orders_not_invoiced: number | string;
}

// Totais de vendas de um afiliado (ou de todos, no summary).
export interface AffiliatesReportTotals {
  sales_count: number;
  items_sold_count: number;
  total_sold: number;
  // Lucro gerado = contribution_value do sales report (comissões já descontadas no custo).
  profit: number;
  // Comissão devida = só de pedido faturado (regra do snapshot).
  affiliated_comission: number;
  // Vendas válidas ainda não faturadas (contam em vendas, sem comissão).
  orders_not_invoiced: number;
}

export interface AffiliatesReportAffiliate extends AffiliatesReportTotals {
  affiliated_id: string;
  affiliated_name: string | null;
  coupon_codes: string | null;
}

export interface AffiliatesReport {
  filters: { start_date: string; end_date: string; affiliated_id: string[] | null };
  summary: AffiliatesReportTotals & { affiliates_count: number; affiliates_with_sales: number };
  affiliates: AffiliatesReportAffiliate[];
}
