import { Request, Response } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import OrderItems from "./order_items.model";
import orderItemsService, { OrderItemsService } from "./order_items.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { QueryParams } from "../../../../shared/query/query.types";
import {
  resolveApplicationStoreFilter,
  storeNumberErrorStatus,
} from "../../../../shared/query/store-number";

class OrderItemsController extends BaseController<
  OrderItems,
  OrderItemsService
> {
  constructor() {
    super(orderItemsService);

    this.router.get(
      `/sales-detail/get`,
      ...this.mw("salesDetail"),
      this.salesDetail,
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],

      salesDetail: [authenticate, userPermissions],
      // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  salesDetail = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {
        page,
        perPage,
        sortBy,
        sortDir,
        search,
        startDate,
        endDate,
        unitBusinessId,
        orderId,
        sellerId,
        productId,
        customerId,
      } = req.query;

      const params: QueryParams = {
        page: page ? Number(page) : undefined,
        perPage: perPage ? Number(perPage) : undefined,
        sortBy: sortBy ? String(sortBy) : undefined,
        sortDir: sortDir as any,
        search: search ? String(search) : undefined,
      };

      // store_number de application (uma ou várias lojas) tem prioridade; sem ele, ?unitBusinessId= como antes.
      const storeFilter = await resolveApplicationStoreFilter(req);
      const storeUnitBusinessIds = storeFilter?.unitBusinessIds;

      const result = await this.service.paginateSalesDetail(params, {
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        unitBusinessId: storeUnitBusinessIds
          ? storeUnitBusinessIds.length === 1
            ? storeUnitBusinessIds[0]
            : storeUnitBusinessIds
          : unitBusinessId
            ? String(unitBusinessId)
            : undefined,
        sellerId: sellerId ? String(sellerId) : undefined,
        productId: productId ? String(productId) : undefined,
        customerId: customerId ? String(customerId) : undefined,
        orderId: orderId ? String(orderId) : undefined
      });

      return res.json(result);
    } catch (error: any) {
      console.log(
        `[OrderItemsController] Erro ao buscar relatório de vendas por item`,
        error,
      );
      return res.status(storeNumberErrorStatus(error, 500)).json({
        error: error.message,
      });
    }
  };
}

export default new OrderItemsController();