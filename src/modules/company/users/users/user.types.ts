import { USER_TYPE_CONFIG } from "../../../../shared/constants/user-types";
import UnitBusiness from "../../unit-business/unit-business.model";
import Role from "../roles/role.model";
import UserConfig from "../user_config/user_config.model";
import { UserConfigAttributes } from "../user_config/user_config.types";

export interface UserAttributes {
  id: string;
  id_system?: number | null;
  name: string;
  cpf: string;
  unit_business_id: string;
  main_unit_business_id?: string | null;
  role_id: string;
  email: string;
  password: string;
  config?: UserConfigAttributes;
  businessToView?: string | string[]
  allowedModules?: USER_TYPE_CONFIG
  availableUnitBusinesses?: UnitBusiness[]
  role?: Role;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserCreationAttributes extends Omit<UserAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

