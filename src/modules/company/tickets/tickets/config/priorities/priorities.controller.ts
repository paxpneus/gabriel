import BaseController from "../../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../middlewares/user-permissions";
import Priority from "./priorities.model";
import priorityService, { PriorityService } from "./priorities.service";
export class PriorityController extends BaseController<Priority, PriorityService> { constructor() { super(priorityService); } protected middlewaresFor() { return { index: [authenticate, userPermissions], show: [authenticate, userPermissions], create: [authenticate, userPermissions], bulkCreate: [authenticate, userPermissions], update: [authenticate, userPermissions], destroy: [authenticate, userPermissions], bulkDestroy: [authenticate, userPermissions] }; } }
export default new PriorityController();
