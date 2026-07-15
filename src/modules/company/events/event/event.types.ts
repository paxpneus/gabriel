import { Transaction } from "sequelize";

export interface EventAttributes {
  id: string;
  title: string;
  description?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EventCreationAttributes extends Omit<EventAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export interface NotifyByUserTypeParams {
  types: string[]; // ex: ['operator', 'admin']
  unitBusinessId: string;
  title: string;
  description?: string;
  socketEvent: string; // ex: 'invoice:created'
  payload: Record<string, unknown>;
  transaction?: Transaction;
}

export interface EventWithReadStatus extends EventAttributes {
  read_at: Date | null;
}