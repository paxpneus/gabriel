import Transporter from "../../transporter/transporter.model";
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
  received_at?: Date;
  expected_receiving?: Date;
  transporter_name?: string | null;
  transporter_document?: string | null;
}

export interface InvoiceCreationAttributes extends Omit<InvoiceAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export type InvoiceWithTransporter = Invoice & {
  transporter: Transporter;
};