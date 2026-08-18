import BaseService from "../../../../../shared/utils/base-models/base-service";
import Ticket from "./tickets.model";
import ticketRepository, { TicketRepository } from "./tickets.repository";
export class TicketService extends BaseService<Ticket, TicketRepository> { constructor() { super(ticketRepository); this.queryConfig = { filterableFields: ["requester_user_id", "area_id", "priority_id", "status_id"], sortableFields: ["title", "completed_at", "createdAt", "updatedAt"], searchFields: ["title", "description"], defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" } }; } }
export default new TicketService();
