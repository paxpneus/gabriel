import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import TicketStatusHistory from "./ticket-status-histories.model";
export class TicketStatusHistoryRepository extends BaseRepository<TicketStatusHistory> { constructor() { super(TicketStatusHistory); } }
export default new TicketStatusHistoryRepository();
