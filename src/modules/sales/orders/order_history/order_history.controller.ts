import BaseController from "../../../../shared/utils/base-models/base-controller";
import OrderHistory from "./order_history.model";
import orderHistoryService, { OrderHistoryService } from "./order_history.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";

class OrderHistoryController extends BaseController<
  OrderHistory,
  OrderHistoryService
> {
  constructor() {
    super(orderHistoryService);
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
export default new OrderHistoryController();
