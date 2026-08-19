import BaseService from "../../../../../shared/utils/base-models/base-service";
import TicketCategoryOption from "./ticket-category-options.model";
import ticketCategoryOptionRepository, { TicketCategoryOptionRepository } from "./ticket-category-options.repository";
export class TicketCategoryOptionService extends BaseService<TicketCategoryOption, TicketCategoryOptionRepository> { constructor() { super(ticketCategoryOptionRepository); } }
export default new TicketCategoryOptionService();
