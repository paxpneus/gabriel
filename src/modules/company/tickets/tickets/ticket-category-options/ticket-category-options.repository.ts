import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import TicketCategoryOption from "./ticket-category-options.model";
export class TicketCategoryOptionRepository extends BaseRepository<TicketCategoryOption> { constructor() { super(TicketCategoryOption); } }
export default new TicketCategoryOptionRepository();
