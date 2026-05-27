import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import OperationsItens from "./operations-itens.model";
import OperationsItensService from "./operations-itens.service";

export class OperationsItensController extends BaseController<
  OperationsItens,
  typeof OperationsItensService
> {
  constructor() {
    super(OperationsItensService);
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

export default new OperationsItensController();
