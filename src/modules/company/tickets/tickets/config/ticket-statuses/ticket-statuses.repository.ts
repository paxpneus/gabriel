import BaseRepository from "../../../../../../shared/utils/base-models/base-repository";
import TicketStatus from "./ticket-statuses.model";
export class TicketStatusRepository extends BaseRepository<TicketStatus> { constructor() { super(TicketStatus); } }
export default new TicketStatusRepository();
