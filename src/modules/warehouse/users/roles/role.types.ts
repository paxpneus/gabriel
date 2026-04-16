export interface RoleAttributes {
  id: string;
  name: string;
  permissions: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RoleCreationAttributes extends Omit<RoleAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
