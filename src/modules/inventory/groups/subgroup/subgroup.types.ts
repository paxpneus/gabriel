import type Group from "../group/group.model";

export interface SubgroupAttributes {
  id: string;
  name: string;
  group_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SubgroupCreationAttributes
  extends Omit<SubgroupAttributes, "id" | "createdAt" | "updatedAt"> {}

export interface SubgroupWithGroup extends SubgroupAttributes {
  group?: Group;
}
