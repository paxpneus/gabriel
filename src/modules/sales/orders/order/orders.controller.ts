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

    this.router.get(
      `/:id/sales-report`,
      ...this.mw("getOrderSalesReportDetail"),
      this.getOrderSalesReportDetail,
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
          getOrderSalesReportDetail: [authenticate, userPermissions],
        };
      }


  releaseWaitingAcceptanceForToday = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const releasedOrders =
        await this.service.releaseWaitingAcceptanceForToday();

      // Zerar a flag não agenda a NFe sozinho — cada pedido liberado precisa
      // retomar o agendamento (PATCH da situação Bling + job delayed), que
      // MLOrderSyncQueue.resumeAfterAcceptance faz sob o lock do pedido.
      for (const order of releasedOrders) {
        if (!order.id_order_system) {
          console.warn(
            `[OrdersController] Pedido ${order.id} liberado sem id_order_system — não é possível retomar o agendamento.`,
          );
          continue;
        }

        await req.app.locals.MLOrderSyncQueue.add(
          { resumeOrderId: order.id_order_system },
          `ml-resume-${order.id_order_system}`,
        );
      }

      console.log(
        `[OrdersService] ${releasedOrders.length} pedido(s) liberados — waiting_acceptance → false.`,
      );
      return res.json({
        message: `${releasedOrders.length} pedido(s) liberados — waiting_acceptance → false.`,
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

  getOrderSalesReportDetail = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const detail = await this.service.getOrderSalesReportDetail(
        req.params.id as string,
      );
      return res.json(detail);
    } catch (error: any) {
      return res.status(404).json({
        error: error.message,
      });
    }
  };
}

export default new OrderController();
