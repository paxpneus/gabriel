export interface UserAttributes {
  id: string;
  name: string;
  cpf: string;
  unit_business_id: string;
  role_id: string;
  email: string;
  password: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserCreationAttributes extends Omit<UserAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export interface RoleAttributes {
  id: string;
  name: string;
  permissions: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RoleCreationAttributes extends Omit<RoleAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
