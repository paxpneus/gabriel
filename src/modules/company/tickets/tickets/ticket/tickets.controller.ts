import BaseController from "../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import Ticket from "./tickets.model";
import ticketService, { TicketService } from "./tickets.service";
export class TicketController extends BaseController<Ticket, TicketService> {
  constructor() {
    super(ticketService);
  }
  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}
export default new TicketController();
