import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import TicketAssignee from "./ticket-assignees.model";
export class TicketAssigneeRepository extends BaseRepository<TicketAssignee> { constructor() { super(TicketAssignee); } }
export default new TicketAssigneeRepository();
