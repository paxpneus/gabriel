export interface OperationsItensAttributes {
  id: string;
  operation_id: string;
  product_id: string;
  code?: string | null;
  quantity: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OperationsItensCreationAttributes
  extends Omit<OperationsItensAttributes, "id" | "createdAt" | "updatedAt"> {}
