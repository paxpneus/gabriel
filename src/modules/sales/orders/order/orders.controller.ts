import { Request, Response } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import orderService, { OrderService } from "./orders.service";
import Order from "./orders.model";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";

class OrderController extends BaseController<Order, OrderService> {
  constructor() {
    super(orderService);

    this.router.post(
      `/release-waiting-acceptance-for-today`,
      ...this.mw("releaseWaitingAcceptanceForToday"),
      this.releaseWaitingAcceptanceForToday,
    );
  }

    protected middlewaresFor() {
        return {
          index: [authenticate, userPermissions],
          create: [authenticate, userPermissions],
          update: [authenticate, userPermissions],
          show: [authenticate, userPermissions],
          destroy: [authenticate, userPermissions],

          releaseWaitingAcceptanceForToday: [authenticate, userPermissions],
        };
      }
  

  releaseWaitingAcceptanceForToday = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const affectedCount =
        await this.service.releaseWaitingAcceptanceForToday();

      console.log(
        `[OrdersService] ${affectedCount} pedido(s) liberados — waiting_acceptance → false.`,
      );
      return res.json({
        message: `${affectedCount} pedido(s) liberados — waiting_acceptance → false.`,
      });
    } catch (error: any) {
      console.log(
        `[OrdersService] Error ao liberar pedidos em aguarde para gerar nota fiscal hoje`,
        error,
      );
      return res.status(500).json({
      error: error.message,
    });
    }
  };
}

export default new OrderController();
