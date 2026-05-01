import { authenticate } from "../../../../middlewares/auth-token";
import BaseController from "../../../../shared/utils/base-models/base-controller";
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
  }

  protected middlewaresFor() {
    return {
      index: [authenticate],
      create: [authenticate],
      update: [authenticate],
      show: [authenticate],
      destroy: [authenticate],
    };
  }

    private registerCustomRoutes(): void {
    this.router.delete("/remove-item/")

    this.router.delete("/remove-item/:id/batch/:batchId", (req, res) => this.removeItem(req, res))
  }


   removeItem = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id, batchId } = req.params;

      if (!batchId) {
        return res.status(400).json({ error: "Lote não encontrado!" });
      }

      const batch = await this.service.removeItem(id as string, batchId as string);
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

}
export default new InventoryBatchItemsController();
