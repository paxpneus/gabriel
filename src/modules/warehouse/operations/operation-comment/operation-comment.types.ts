export interface OperationCommentAttributes {
  id: string;
  userId: string;
  unitBusinessId: string;
  operationId: string;
  comment: string;
  pointTo?: string | null;
  date: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OperationCommentCreationAttributes
  extends Omit<OperationCommentAttributes, "id" | "createdAt" | "updatedAt"> {}
