import { authenticate, AuthRequest } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import { getUserContext } from "../../../../shared/query/get-logged-user";
import InventoryBatchItems from "./inventory-batch-items.model";
import inventoryBatchItemsService, {
  InventoryBatchItemsService,
} from "./inventory-batch-items.service";
import { Request, Response } from "express";

class InventoryBatchItemsController extends BaseController<
  InventoryBatchItems,
  InventoryBatchItemsService
> {
  constructor() {
    super(inventoryBatchItemsService);
    this.registerCustomRoutes();
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],

      removeItem: [authenticate, userPermissions],
      updateItemQuantity: [authenticate, userPermissions],
    };
  }

  private registerCustomRoutes(): void {
    this.router.delete(
      "/remove-item/:id/batch/:batchId",
      ...this.mw("removeItem"),
      (req, res) => this.removeItem(req, res),
    );

    this.router.put(
      "/update-quantity/:id",
      ...this.mw("updateItemQuantity"),
      (req, res) => this.updateItemQuantity(req, res),
    );
  }

  removeItem = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { id, batchId } = req.params;

      if (!batchId) {
        return res.status(400).json({ error: "Lote não encontrado!" });
      }

      const batch = await this.service.removeItem(
        id as string,
        batchId as string,
      );
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  updateItemQuantity = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { id } = req.params;
      const { quantity, userId: targetUserId } = req.body;
      const roleId = (req as AuthRequest).user?.role;
      const { userId: loggedUserId } = await getUserContext(req);
      const userId = targetUserId || loggedUserId;

      await this.service.updateItemQuantity(
        id as string,
        quantity,
        userId,
        roleId as string,
      );

      return res.status(200).json({ message: "Quantidade atualizada com sucesso" });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new InventoryBatchItemsController();
