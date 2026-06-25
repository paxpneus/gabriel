export interface InvoiceFiscalItemAttributes {
  id: string;
  invoice_id: string;
  product_id?: string | null;
  item_number?: number | null;
  sku?: string | null;
  description?: string | null;
  quantity?: number | string;
  unit_price?: number | string;
  total_value?: number | string;
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
  createdAt?: Date;
  updatedAt?: Date;
}

export type InvoiceFiscalItemCreationAttributes = Omit<
  InvoiceFiscalItemAttributes,
  "id" | "createdAt" | "updatedAt"
>;
