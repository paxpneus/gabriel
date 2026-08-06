export interface StockMovementSourceDataAttributes {
  id?: string;
  extraction_date: Date;
  cutoff_date: Date | null;
  csv_path: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface StockMovementSourceDataCreationAttributes
  extends Omit<StockMovementSourceDataAttributes, "id" | "createdAt" | "updatedAt"> {}
