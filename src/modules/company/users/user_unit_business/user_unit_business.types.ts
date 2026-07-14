export interface UserUnitBusinessAttributes {
  id: string;
  user_id: string;
  unit_business_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserUnitBusinessCreationAttributes
  extends Omit<UserUnitBusinessAttributes, "id" | "createdAt" | "updatedAt"> {}
