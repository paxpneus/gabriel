export interface SalesOrderItemSnapshotAttributes {
  id: string;
  order_snapshot_id: string;
  order_id: string;
  order_item_id?: string | null;
  product_id?: string | null;
  store_id?: string | null;
  unit_business_id?: string | null;
  integration_id?: string | null;

  order_date: string;
  destination_uf?: string | null;

  sku: string;
  description?: string | null;
  unit?: string | null;

  product_brand?: string | null;
  product_measure?: string | null;

  quantity?: number | string;
  unit_price?: number | string;
  gross_total?: number | string;
  discount_value?: number | string;
  net_total?: number | string;

  average_cost_snapshot?: number | string;
  total_cost_snapshot?: number | string;
  cost_source?: string | null;

  tax_commission_allocated?: number | string;
  freight_cost_allocated?: number | string;
  computed_icms_value_allocated?: number | string;

  contribution_value?: number | string;
  contribution_pct?: number | string;

  markup_pct?: number | string;

  commission_base?: number | string;
  commission_rate?: number | string;
  commission_value?: number | string;

  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  gtin?: string | null;

  approx_tax_value?: number | string;
  icms_rate?: number | string;
  icms_value?: number | string;
  ipi_value?: number | string;
  pis_value?: number | string;
  cofins_value?: number | string;
  difal_value?: number | string;
  ibs_value?: number | string;
  cbs_value?: number | string;

  source_payload?: Record<string, unknown> | null;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SalesOrderItemSnapshotCreationAttributes = Omit<
  SalesOrderItemSnapshotAttributes,
  "id" | "createdAt" | "updatedAt"
>;
