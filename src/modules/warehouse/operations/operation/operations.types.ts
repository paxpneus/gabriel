import { OperationsItensAttributes } from "../operations-itens/operations-itens.types";

export type OperationStatus = "OPEN" | "PENDING" | "FINISHED";

export interface OperationsAttributes {
  id: string;
  description?: string | null;
  date?: Date | null;
  due_at?: Date | null;
  expected_at?: Date | null;
  status: OperationStatus;
  invoice_id?: string | null;
  from_unit?: string | null;
  to_unit?: string | null;
  transporter_name?: string | null;
  total_quantity: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OperationsCreationAttributes
  extends Omit<OperationsAttributes, "id" | "createdAt" | "updatedAt"> {}

export type CreateOperationItemDTO = Omit<
  OperationsItensAttributes,
  "id" | "operation_id" | "createdAt" | "updatedAt"
>;

export type CreateOperationWithItemsDTO = Partial<OperationsCreationAttributes> & {
  items?: Omit<
    OperationsItensAttributes,
    "id" | "operation_id" | "createdAt" | "updatedAt"
  >[];
};
