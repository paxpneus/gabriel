import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import Transporter from "../../transporter/transporter.model";
import InvoiceItems from "../invoice-items/invoice-items.model";
import Invoice from "./invoice.model";

export interface InvoiceAttributes {
  id: string;
  customer_name: string;
  customer_document: string;
  xml_path?: string | null;
  xml_key?: string | null;
  danfe_path?: string;
  unit_business_id: string;
  store_id: string
  sender_cnpj: string;
  sender_name: string;
  receiver_cnpj: string;
  receiver_name: string;
  integrations_id?: string;
  id_system?: string;
  transporter_id?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  type: string;
  status: string;
  batch_generated?: boolean;
  printed_label?: boolean;
  emitted_at?: Date;
  number_system?: string;
  received_at?: string;
  expected_receiving?: string;
  transporter_name?: string | null;
  transporter_document?: string | null;
  total_read?: number;
  total_expected?: number;
  description?: string | null;
  bonded_invoice?: string | null;
  external_id?: string | null;
  invoice_series?: string | null;
  invoice_value?: number;
  invoice_products_value?: number;
  invoice_freight_value?: number;
  invoice_discount_value?: number;
  invoice_other_value?: number;
  invoice_total_tax_value?: number;
  icms_value?: number;
  ipi_value?: number;
  pis_value?: number;
  cofins_value?: number;
  difal_value?: number;
  ibs_value?: number;
  cbs_value?: number;
  destination_uf?: string | null;
  destination_city?: string | null;
  xml_url?: string | null;
  source_payload?: Record<string, unknown> | null;
}

export interface FullInvoice extends InvoiceAttributes {
  unmappedProducts: UnmappedInvoiceProduct[]
  items: InvoiceItems[]
}

export interface InvoiceCreationAttributes extends Omit<InvoiceAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export type InvoiceWithTransporter = Invoice & {
  transporter: Transporter;
};
