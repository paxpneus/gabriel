import UnitBusiness from "../../unit-business/unit-business.model";
import Role from "../roles/role.model";
import UserConfig from "../user_config/user_config.model";

export interface UserAttributes {
  id: string;
  name: string;
  cpf: string;
  unit_business_id: string;
  role_id: string;
  email: string;
  password: string;
  config?: UserConfig;
  availableUnitBusinesses?: UnitBusiness[]
  role?: Role;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserCreationAttributes extends Omit<UserAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

