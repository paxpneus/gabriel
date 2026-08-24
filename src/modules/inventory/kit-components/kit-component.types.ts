export interface KitComponentAttributes {
  id: string;
  product_kit_id: string;
  product_component_id: string;
  quantity: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface KitComponentCreationAttributes
  extends Omit<KitComponentAttributes, "id" | "createdAt" | "updatedAt"> {}
