import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController from "../../../shared/utils/base-models/base-controller";
import KitComponent from "./kit-component.model";
import KitComponentService from "./kit-component.service";

export class KitComponentController extends BaseController<
  KitComponent,
  typeof KitComponentService
> {
  constructor() {
    super(KitComponentService);
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
    };
  }
}

export default new KitComponentController();
