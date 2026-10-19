import BaseController from "../../../shared/utils/base-models/base-controller";
import Step from "./steps.model";
import stepService, { StepService } from "./steps.service";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";

class StepController extends BaseController<Step, StepService> {
  constructor() {
    super(stepService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      // Ações do CRUD genérico sem chave aqui ficavam sem middleware nenhum.
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}
export default new StepController();
