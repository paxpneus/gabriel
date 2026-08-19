import BaseController from "../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import Subtask from "./subtasks.model";
import subtaskService, { SubtaskService } from "./subtasks.service";
export class SubtaskController extends BaseController<Subtask, SubtaskService> { constructor() { super(subtaskService); } protected middlewaresFor() { return { index: [authenticate, userPermissions], show: [authenticate, userPermissions], create: [authenticate, userPermissions], bulkCreate: [authenticate, userPermissions], update: [authenticate, userPermissions], destroy: [authenticate, userPermissions], bulkDestroy: [authenticate, userPermissions] }; } }
export default new SubtaskController();
