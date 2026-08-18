import BaseService from "../../../../../../shared/utils/base-models/base-service";
import TicketStatus from "./ticket-statuses.model";
import ticketStatusRepository, { TicketStatusRepository } from "./ticket-statuses.repository";
export class TicketStatusService extends BaseService<TicketStatus, TicketStatusRepository> { constructor() { super(ticketStatusRepository); this.queryConfig = { filterableFields: ["completed", "canceled", "is_active"], sortableFields: ["name", "display_order", "createdAt"], searchFields: ["name"], defaults: { perPage: 20, sortBy: "display_order", sortDir: "ASC" } }; } }
export default new TicketStatusService();
