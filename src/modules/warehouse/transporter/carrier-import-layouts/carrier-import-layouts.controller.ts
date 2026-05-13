import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import CarrierImportLayout from "./carrier-import-layouts.model";
import CarrierImportLayoutService from "./carrier-import-layouts.service";

export class CarrierImportLayoutController extends BaseController<
  CarrierImportLayout,
  typeof CarrierImportLayoutService
> {
  constructor() {
    super(CarrierImportLayoutService);
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

export default new CarrierImportLayoutController();
