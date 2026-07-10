import type Subgroup from "../subgroup/subgroup.model";

export enum GroupType {
  PRODUCTS = "PRODUCTS",
}

export interface GroupAttributes {
  id: string;
  name: string;
  type: GroupType;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface GroupCreationAttributes
  extends Omit<GroupAttributes, "id" | "createdAt" | "updatedAt"> {}

export interface GroupWithSubgroups extends GroupAttributes {
  subgroups?: Subgroup[];
}
