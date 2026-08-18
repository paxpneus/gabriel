import Area from "../../../../global/areas/areas.model";
import { User } from "../../../../warehouse";
import Priority from "../config/priorities/priorities.model";
import TicketStatus from "../config/ticket-statuses/ticket-statuses.model";
import TicketAssignee from "../ticket-assignees/ticket-assignees.model";
import { FullTicketAssignee } from "../ticket-assignees/ticket-assignees.types";
import TicketCategoryOption from "../ticket-category-options/ticket-category-options.model";
import { FullTicketCategoryOption } from "../ticket-category-options/ticket-category-options.types";
import Ticket from "./tickets.model";

export interface TicketAttributes {
  id: string;
  title: string;
  description: string;
  requester_user_id: string;
  area_id: string;
  priority_id: string;
  status_id: string;
  completed_at?: Date | null;
  due_date?: Date | null;
  is_late: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface TicketCreationAttributes extends Omit<
  TicketAttributes,
  "id" | "createdAt" | "updatedAt"
> {}

export interface FullTicket extends Ticket {
  requester: User,
  area: Area,
  status: TicketStatus,
  assignees: FullTicketAssignee,
  categoryOptions: FullTicketCategoryOption[]
  priority: Priority
}
