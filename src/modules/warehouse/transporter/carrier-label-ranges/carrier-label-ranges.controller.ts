import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import CarrierLabelRange from "./carrier-label-ranges.model";
import CarrierLabelRangeService from "./carrier-label-ranges.service";

export class CarrierLabelRangeController extends BaseController<
  CarrierLabelRange,
  typeof CarrierLabelRangeService
> {
  constructor() {
    super(CarrierLabelRangeService);
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

export default new CarrierLabelRangeController();
