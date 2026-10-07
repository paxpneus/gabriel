export interface UnitBusinessGroupAttributes {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UnitBusinessGroupCreationAttributes
  extends Omit<UnitBusinessGroupAttributes, "id" | "createdAt" | "updatedAt"> {}
