// Escopo da consulta: afiliado vem sempre do usuário logado, nunca do request.
export interface AffiliatedReportFilters {
  affiliatedId: string;
  startDate: string;
  endDate: string;
}

// Item do pedido no JSON_AGG do repository (valores já rateados pelo snapshot).
export interface AffiliatedReportItemRow {
  product_id: string | null;
  name: string | null;
  brand: string | null;
  measure: string | null;
  quantity: number | string | null;
  gross_total: number | string | null;
  net_total: number | string | null;
  commission: number | string | null;
}

// Linha do repository: um pedido do afiliado, já agregado no SQL (Postgres devolve numeric como string).
export interface AffiliatedReportOrderRow {
  order_id: string;
  order_date: string;
  order_number: string | null;
  gross_total: string | number | null;
  net_total: string | number | null;
  commission: string | number | null;
  commission_rate: string | number | null;
  coupon_code: string | null;
  invoiced: boolean;
  items: AffiliatedReportItemRow[];
}

// Pedido como o afiliado vê: bruto − desconto = líquido (base), líquido × taxa = comissão (0 enquanto não faturado).
export interface AffiliatedReportOrder {
  order_id: string;
  order_date: string;
  order_number: string | null;
  coupon_code: string | null;
  gross_total: number;
  discount_value: number;
  net_total: number;
  commission_rate: number | null;
  commission: number;
  invoiced: boolean;
  products: { name: string | null; quantity: number }[];
}

// Ponto da evolução (dia, semana a partir de segunda, mês a partir do dia 1).
export interface AffiliatedReportEvolutionPoint {
  period: string;
  orders_count: number;
  gross_total: number;
  discount_total: number;
  net_total: number;
  commission: number;
}

// Produto somado no período, desconto do pedido já rateado pelo mesmo peso da comissão.
export interface AffiliatedReportProduct {
  product_id: string | null;
  product_name: string | null;
  product_brand: string | null;
  product_measure: string | null;
  quantity: number;
  gross_total: number;
  discount_value: number;
  net_total: number;
  commission_value: number;
}

// Destaque do ranking: o produto de `products` só com quantidade e comissão.
export type AffiliatedReportRankingProduct = Pick<
  AffiliatedReportProduct,
  "product_id" | "product_name" | "product_brand" | "product_measure" | "quantity" | "commission_value"
>;

// Cupom ativo do afiliado com a taxa de comissão vigente (%).
export interface AffiliatedReportCoupon {
  code: string;
  commission_rate: number;
}

// Resposta do GET /api/affiliated-report.
export interface AffiliatedReport {
  summary: {
    orders_count: number;
    gross_total: number;
    discount_total: number;
    net_total: number;
    total_commission: number;
    commission_pct: number;
  };
  coupons: AffiliatedReportCoupon[];
  orders: AffiliatedReportOrder[];
  evolution: {
    daily: AffiliatedReportEvolutionPoint[];
    weekly: AffiliatedReportEvolutionPoint[];
    monthly: AffiliatedReportEvolutionPoint[];
  };
  products: AffiliatedReportProduct[];
  ranking: {
    most_sold_product: AffiliatedReportRankingProduct | null;
    highest_commission_product: AffiliatedReportRankingProduct | null;
  };
  by_coupon: { code: string | null; orders_count: number; net_total: number; commission: number }[];
}
