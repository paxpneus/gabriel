import { Product } from "../../../inventory";
import User from "../../users/users/user.model";
import { OperationsItensAttributes } from "../operations-itens/operations-itens.types";

export type OperationStatus = "OPEN" | "PENDING" | "FINISHED" | "CANCELLED";
export type OperationPriorityLevel = "URGENT" | "HIGH" | "REGULAR" | "LOW";

export interface OperationsAttributes {
  id: string;
  description?: string | null;
  date?: Date | null;
  due_at?: Date | null;
  expected_at?: Date | null;
  status: OperationStatus;
  priority_level?: OperationPriorityLevel | null;
  justification_priority_level?: string | null;
  request_user?: string | null;
  receiver_user?: string | null;
  requestUser?: User;
  receiverUser?: User;
  invoice_id?: string | null;
  invoice_number?: string
  from_unit?: string | null;
  to_unit?: string | null;
  transporter_name?: string | null;
  total_quantity: number;
  receiver_confirmation?: boolean;
  sender_confirmation?: boolean;
  note?: string
  code?: string;
  items?: OperationsItensAttributes[]
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
