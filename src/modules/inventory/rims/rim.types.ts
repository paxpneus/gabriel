export interface RimAttributes {
  id: string;
  value: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RimCreationAttributes
  extends Omit<RimAttributes, "id" | "createdAt" | "updatedAt"> {}
