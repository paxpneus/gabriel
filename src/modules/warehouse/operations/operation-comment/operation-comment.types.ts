export interface OperationCommentAttributes {
  id: string;
  user_id: string;
  unit_business_id: string;
  operation_id: string;
  comment: string;
  point_to?: string | null;
  date: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OperationCommentCreationAttributes
  extends Omit<OperationCommentAttributes, "id" | "createdAt" | "updatedAt"> {}
