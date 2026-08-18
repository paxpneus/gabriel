import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import Ticket from "./tickets.model";
export class TicketRepository extends BaseRepository<Ticket> {
  constructor() {
    super(Ticket);
  }
}
export default new TicketRepository();
