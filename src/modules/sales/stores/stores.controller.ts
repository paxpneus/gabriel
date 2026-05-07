import BaseController from "../../../shared/utils/base-models/base-controller";
import Store from "./stores.model";
import storeService, { StoreService } from "./stores.service";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";

class StoreController extends BaseController<Store, StoreService> {
  constructor() {
    super(storeService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
    };
  }
}

export default new StoreController();
