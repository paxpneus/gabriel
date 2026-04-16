export interface InvoiceItemsAttributes {
  id: string;
  product_id: string;
  invoice_id: string;
  quantity_expected: number;
  quantity_received: number;
  status: 'PENDING' | 'FINISHED';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceItemsCreationAttributes extends Omit<InvoiceItemsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
