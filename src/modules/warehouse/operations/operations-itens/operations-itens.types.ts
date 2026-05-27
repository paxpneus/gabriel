export interface OperationsItensAttributes {
  id: string;
  operation_id: string;
  product_id?: string | null;
  code?: string | null;
  quantity: number;
  description?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OperationsItensCreationAttributes
  extends Omit<OperationsItensAttributes, "id" | "createdAt" | "updatedAt"> {}
