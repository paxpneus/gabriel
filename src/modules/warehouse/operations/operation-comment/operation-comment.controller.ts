import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import OperationComment from "./operation-comment.model";
import OperationCommentService from "./operation-comment.service";

export class OperationCommentController extends BaseController<
  OperationComment,
  typeof OperationCommentService
> {
  constructor() {
    super(OperationCommentService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}

export default new OperationCommentController();
