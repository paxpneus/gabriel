export interface StateAttributes {
  id: string;
  acronym: string;
  name: string;
  icms_rate: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface StateCreationAttributes
  extends Omit<StateAttributes, "id" | "createdAt" | "updatedAt"> {}
