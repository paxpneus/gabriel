export interface InvoiceAttributes {
  id: string;
  customer_name: string;
  customer_document: string;
  key: string;
  xml_path?: string;
  danfe_path?: string;
  unit_business_id: string;
  sender_cnpj: string;
  sender_name: string;
  receiver_cnpj: string;
  receiver_name: string;
  integrations_id?: string;
  id_system?: string;
  transporter_id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  type: string;
  status: string;
  batch_generated?: boolean;
  printed_label?: boolean;
  emitted_at?: Date;
  number_system?: string;
}

export interface InvoiceCreationAttributes extends Omit<InvoiceAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
