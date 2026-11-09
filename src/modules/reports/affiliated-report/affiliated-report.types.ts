// Escopo da consulta: afiliado vem sempre do usuário logado, nunca do request.
export interface AffiliatedReportFilters {
  affiliatedId: string;
  startDate: string;
  endDate: string;
}

// Linha do repository: um pedido do afiliado, já agregado no SQL (Postgres devolve numeric como string).
export interface AffiliatedReportOrderRow {
  order_id: string;
  order_date: string;
  order_number: string | null;
  total_sold: string | number | null;
  commission: string | number | null;
  products: { name: string | null; quantity: number }[];
}

// Pedido como o afiliado vê: só valor da venda, produtos e a comissão dele (sem cliente, custo ou lucro).
export interface AffiliatedReportOrder {
  order_id: string;
  order_date: string;
  order_number: string | null;
  total_sold: number;
  commission: number;
  products: { name: string | null; quantity: number }[];
}

// Cupom ativo do afiliado com a taxa de comissão vigente (%).
export interface AffiliatedReportCoupon {
  code: string;
  commission_rate: number;
}

// Resposta do GET /api/affiliated-report.
export interface AffiliatedReport {
  summary: { total_commission: number };
  coupons: AffiliatedReportCoupon[];
  orders: AffiliatedReportOrder[];
}
