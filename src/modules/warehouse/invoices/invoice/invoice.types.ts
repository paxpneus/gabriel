import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import { ExpeditionBatchInvoiceAttributes } from "../../expedition/batch-invoices/batch-invoices.types";
import Transporter from "../../transporter/transporter.model";
import { InvoiceFiscalItemCreationAttributes } from "../invoice-fiscal-item/invoice-fiscal-item.types";
import InvoiceItems from "../invoice-items/invoice-items.model";
import { InvoiceItemsAttributes } from "../invoice-items/invoice-items.types";
import { InvoiceUnitBusinessAttributesAttributes } from "../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import Invoice from "./invoice.model";

export type InvoiceStatus =
  | "OPEN"
  | "PENDING"
  | "FINISHED"
  | "CANCELLED"
  | "FREE_TO_SCHEDULE"
  | "WAITING_SCHEDULE_SALES"
  | "SCHEDULED"
  | "LATE"
  | "PENDING_CANCELLED_SYSTEM";
export interface InvoiceAttributes {
  id: string;
  customer_name: string;
  customer_document: string;
  xml_path?: string | null;
  xml_key?: string | null;
  danfe_path?: string;
  unit_business_id: string;
  store_id: string;
  sender_cnpj: string;
  sender_name: string;
  receiver_cnpj: string;
  receiver_name: string;
  integrations_id?: string;
  id_system?: string;
  transporter_id?: string | null;
  seller_id?: string | null;
  supplier_id?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  type: "INCOMING" | "OUTGOING";
  status: InvoiceStatus;
  unitBusinessAttributes?: InvoiceUnitBusinessAttributesAttributes[]
  items?: InvoiceItems[];
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
  sefaz_manifestation_status?: SefazManifestationStatus | null;
  sefaz_n_seq_evento?: number;
  sefaz_nsu?: string | null;
  sefaz_full_xml_attempts?: number | null;
  sefaz_full_xml_last_query_at?: Date | null;
  transporter?: Transporter;
}

export interface FullInvoiceAttributes {
  id: string;
  customer_name: string;
  customer_document: string;
  xml_path?: string | null;
  xml_key?: string | null;
  danfe_path?: string;
  unit_business_id: string;
  store_id: string;
  sender_cnpj: string;
  sender_name: string;
  receiver_cnpj: string;
  receiver_name: string;
  integrations_id?: string;
  id_system?: string;
  transporter_id?: string | null;
  seller_id?: string | null;
  supplier_id?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  type: "INCOMING" | "OUTGOING";
  status: InvoiceStatus;
  unitBusinessAttributes?: InvoiceUnitBusinessAttributesAttributes;
  batchInvoice?: ExpeditionBatchInvoiceAttributes;
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
  sefaz_manifestation_status?: SefazManifestationStatus | null;
  sefaz_n_seq_evento?: number;
  sefaz_nsu?: string | null;
  sefaz_full_xml_attempts?: number | null;
  sefaz_full_xml_last_query_at?: Date | null;
  transporter?: Transporter;
}

export interface FullInvoiceAttributesForAllUnits {
  id: string;
  customer_name: string;
  customer_document: string;
  xml_path?: string | null;
  xml_key?: string | null;
  danfe_path?: string;
  unit_business_id: string;
  store_id: string;
  sender_cnpj: string;
  sender_name: string;
  receiver_cnpj: string;
  receiver_name: string;
  integrations_id?: string;
  id_system?: string;
  transporter_id?: string | null;
  seller_id?: string | null;
  supplier_id?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  type: "INCOMING" | "OUTGOING";
  status: InvoiceStatus;
  unitBusinessAttributes?: InvoiceUnitBusinessAttributesAttributes[];
  batchInvoice?: ExpeditionBatchInvoiceAttributes;
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
  sefaz_manifestation_status?: SefazManifestationStatus | null;
  sefaz_n_seq_evento?: number;
  sefaz_nsu?: string | null;
  sefaz_full_xml_attempts?: number | null;
  sefaz_full_xml_last_query_at?: Date | null;
  transporter?: Transporter;
}

export type ItemWithFiscal = Omit<InvoiceItemsAttributes, "id" | "invoice_id" | "createdAt" | "updatedAt"> & {
  fiscal?: InvoiceFiscalItemCreationAttributes;
};

export type InvoiceCreationData = Omit<InvoiceAttributes, "id" | "createdAt" | "updatedAt" | "unit_business_id"> & {
  unit_business_id?: string;
};

export interface FullInvoice extends FullInvoiceAttributes {
  unmappedProducts?: UnmappedInvoiceProduct[];
  items: InvoiceItems[];
}

export interface FullInvoiceForAllUnits extends FullInvoiceAttributesForAllUnits {
  unmappedProducts: UnmappedInvoiceProduct[];
  items: InvoiceItems[];
}

export interface InvoiceCreationAttributes extends Omit<
  InvoiceAttributes,
  "id" | "createdAt" | "updatedAt"
> {}

export type InvoiceWithTransporter = Invoice & {
  transporter: Transporter;
};

export type SefazManifestationStatus =
  | "PENDING_CIENCIA"
  | "CIENCIA_ENVIADA"
  | "CIENCIA_REJEITADA"
  | "CONFIRMADO"
  | "DESCONHECIDO"
  | "OPERACAO_NAO_REALIZADA"
  | "AGUARDANDO_PROCNFE"
  | "PROCNFE_DESISTIDO";

