import BaseController from "../../../../shared/utils/base-models/base-controller";
import OrderItems from "./order_items.model";
import orderItemsService, { OrderItemsService } from "./order_items.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";

class OrderItemsController extends BaseController<
  OrderItems,
  OrderItemsService
> {
  constructor() {
    super(orderItemsService);
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

export default new OrderItemsController();
