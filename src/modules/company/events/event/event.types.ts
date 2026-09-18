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
  // omitido: notifica os usuários do(s) tipo(s) em TODAS as unit businesses
  // (evento de sistema, ex.: erro de integração pra developer) em vez de
  // uma loja específica.
  unitBusinessId?: string;
  title: string;
  description?: string;
  transaction?: Transaction;
}

export interface EventWithReadStatus extends EventAttributes {
  read_at: Date | null;
}