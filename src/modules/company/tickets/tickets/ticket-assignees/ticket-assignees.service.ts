import BaseService from "../../../../../shared/utils/base-models/base-service";
import TicketAssignee from "./ticket-assignees.model";
import ticketAssigneeRepository, { TicketAssigneeRepository } from "./ticket-assignees.repository";
export class TicketAssigneeService extends BaseService<TicketAssignee, TicketAssigneeRepository> { constructor() { super(ticketAssigneeRepository); } }
export default new TicketAssigneeService();
