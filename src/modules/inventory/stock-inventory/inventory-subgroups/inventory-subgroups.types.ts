export interface InventorySubgroupAttributes {
  id: string;
  inventory_batch_id: string;
  subgroup_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InventorySubgroupCreationAttributes
  extends Omit<InventorySubgroupAttributes, "id" | "createdAt" | "updatedAt"> {}
