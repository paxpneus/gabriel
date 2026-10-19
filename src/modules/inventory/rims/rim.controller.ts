import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController from "../../../shared/utils/base-models/base-controller";
import Rim from "./rim.model";
import RimService from "./rim.service";

export class RimController extends BaseController<Rim, typeof RimService> {
  constructor() {
    super(RimService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      // Ações do CRUD genérico sem chave aqui ficavam sem middleware nenhum.
      bulkUpdate: [authenticate, userPermissions],
    };
  }
}

export default new RimController();
