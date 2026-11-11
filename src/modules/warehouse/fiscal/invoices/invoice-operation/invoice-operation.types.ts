import { Optional } from "sequelize";

// Codes provisórios da tabela invoice_operations (seed na m351): trocar aqui e no seed juntos.
export const INVOICE_OPERATION_CODES = {
  SALE: "10",
  PURCHASE: "20",
  TRANSFER: "30",
  RETURN: "40",
  INTERNAL_TRANSFER: "50",
} as const;

export type InvoiceOperationCode = (typeof INVOICE_OPERATION_CODES)[keyof typeof INVOICE_OPERATION_CODES];

export interface InvoiceOperationAttributes {
  id: string;
  code: string;
  description: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type InvoiceOperationCreationAttributes = Optional<InvoiceOperationAttributes, "id" | "createdAt" | "updatedAt">;
