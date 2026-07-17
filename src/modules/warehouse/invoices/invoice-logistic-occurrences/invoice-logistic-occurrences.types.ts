export type InvoiceLogisticOcurrencesStatus = 'PENDING' | 'SYNCHRONIZED'

export interface InvoiceLogisticOcurrencesAttributes {
  id: string;
  invoice_id: string;
  occurrency_code: string;
  description: string;
  proof_link: string;
  status: InvoiceLogisticOcurrencesStatus;
  date?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceLogisticOcurrencesCreationAttributesAttributes extends Omit<InvoiceLogisticOcurrencesAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

