import { User } from "../../../../warehouse";
import TicketAssignee from "./ticket-assignees.model";

export interface TicketAssigneeAttributes {
  ticket_id: string;
  user_id: string;
  assigned_at?: Date;
}
export interface TicketAssigneeCreationAttributes extends TicketAssigneeAttributes {}

export interface FullTicketAssignee extends TicketAssignee {
    user: User
}