import { Optional } from "sequelize";

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

  freight_value?: number | string;
  insurance_value?: number | string;
  other_expenses_value?: number | string;
  discount_value?: number | string;

  icms_rate?: number | string;
  icms_value?: number | string;
  icms_st_value?: number | string;
  ipi_value?: number | string;
  pis_value?: number | string;
  cofins_value?: number | string;
  difal_value?: number | string;
  ibs_value?: number | string;
  cbs_value?: number | string;

  acquisition_unit_cost?: number | string;

  createdAt?: Date;
  updatedAt?: Date;
}

export type InvoiceFiscalItemCreationAttributes = Optional<
  InvoiceFiscalItemAttributes,
  | "id"
  | "product_id"
  | "item_number"
  | "sku"
  | "description"
  | "quantity"
  | "unit_price"
  | "total_value"
  | "ncm"
  | "cest"
  | "cfop"
  | "gtin"
  | "approx_tax_value"
  | "freight_value"
  | "insurance_value"
  | "other_expenses_value"
  | "discount_value"
  | "icms_rate"
  | "icms_value"
  | "icms_st_value"
  | "ipi_value"
  | "pis_value"
  | "cofins_value"
  | "difal_value"
  | "ibs_value"
  | "cbs_value"
  | "acquisition_unit_cost"
  | "createdAt"
  | "updatedAt"
>;