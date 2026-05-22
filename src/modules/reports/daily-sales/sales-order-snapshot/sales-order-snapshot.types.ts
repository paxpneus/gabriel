export interface SalesOrderSnapshotAttributes {
  id: string;
  order_id: string;
  invoice_id?: string | null;
  integration_id?: string | null;
  customer_id?: string | null;
  store_id?: string | null;
  unit_business_id?: string | null;
  source_system?: string | null;
  external_order_id?: string | null;
  external_order_number?: string | null;
  external_invoice_id?: string | null;
  invoice_number?: string | null;
  invoice_key?: string | null;
  order_date: string;
  invoice_date?: string | null;
  emitted_at?: Date | null;
  destination_uf?: string | null;
  destination_city?: string | null;
  status_id?: string | null;
  status_name?: string | null;
  status_value?: string | null;
  snapshot_status?: string;
  items_quantity?: number | string;
  total_products?: number | string;
  total_order?: number | string;
  discount_value?: number | string;
  other_expenses?: number | string;
  freight_charged?: number | string;
  freight_cost?: number | string;
  freight_paid_by_company?: boolean;
  freight_by_account?: number | null;
  total_cost?: number | string;
  total_taxes?: number | string;
  total_fees?: number | string;
  tax_commission?: number | string;
  marketplace_fee?: number | string;
  payment_fee?: number | string;
  icms_value?: number | string;
  ipi_value?: number | string;
  pis_value?: number | string;
  cofins_value?: number | string;
  difal_value?: number | string;
  ibs_value?: number | string;
  cbs_value?: number | string;
  approx_tax_value?: number | string;
  contribution_value?: number | string;
  contribution_pct?: number | string;
  markup_pct?: number | string;
  has_cost_fallback?: boolean;
  has_invoice_data?: boolean;
  source_payload?: Record<string, unknown> | null;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SalesOrderSnapshotCreationAttributes = Omit<
  SalesOrderSnapshotAttributes,
  "id" | "createdAt" | "updatedAt"
>;
