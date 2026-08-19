import BaseService from "../../../../../shared/utils/base-models/base-service";
import TicketStatusHistory from "./ticket-status-histories.model";
import ticketStatusHistoryRepository, {
  TicketStatusHistoryRepository,
} from "./ticket-status-histories.repository";
export class TicketStatusHistoryService extends BaseService<
  TicketStatusHistory,
  TicketStatusHistoryRepository
> {
  constructor() {
    super(ticketStatusHistoryRepository);
  }
}
export default new TicketStatusHistoryService();
