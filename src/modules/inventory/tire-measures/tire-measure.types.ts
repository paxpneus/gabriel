export interface TireMeasureAttributes {
  id: string;
  value: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TireMeasureCreationAttributes
  extends Omit<TireMeasureAttributes, "id" | "createdAt" | "updatedAt"> {}
