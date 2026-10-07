export interface UnitBusinessGroupMemberAttributes {
  id: string;
  unit_business_group_id: string;
  unit_business_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UnitBusinessGroupMemberCreationAttributes
  extends Omit<UnitBusinessGroupMemberAttributes, "id" | "createdAt" | "updatedAt"> {}
