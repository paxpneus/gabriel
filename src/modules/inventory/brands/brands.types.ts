export interface BrandAttributes {
  id: string;
  name: string;
  seller_comission_tax_rate: number;
  manager_comission_tax_rate: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BrandCreationAttributes
  extends Omit<BrandAttributes, "id" | "createdAt" | "updatedAt"> {}
