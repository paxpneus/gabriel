export interface StockAttributes {
  id?: string;
  product_id: string;
  quantity: number;
  unit_business_id: string;
  total_price?: number;
  // Só leitura (front), vindos da Bling; nenhum fluxo usa — quem conta é `quantity`.
  reserved_quantity?: number | null;
  virtual_stock?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface StockCreationAttributes extends Omit<StockAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
