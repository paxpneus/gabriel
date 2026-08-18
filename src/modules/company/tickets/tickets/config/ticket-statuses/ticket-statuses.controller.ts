import BaseController from "../../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../middlewares/user-permissions";
import TicketStatus from "./ticket-statuses.model";
import ticketStatusService, { TicketStatusService } from "./ticket-statuses.service";
export class TicketStatusController extends BaseController<TicketStatus, TicketStatusService> { constructor() { super(ticketStatusService); } protected middlewaresFor() { return { index: [authenticate, userPermissions], show: [authenticate, userPermissions], create: [authenticate, userPermissions], bulkCreate: [authenticate, userPermissions], update: [authenticate, userPermissions], destroy: [authenticate, userPermissions], bulkDestroy: [authenticate, userPermissions] }; } }
export default new TicketStatusController();
