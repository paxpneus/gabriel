import { authenticate } from "../../../../middlewares/auth-token";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import InventoryBatchLogs from "./inventory-batch-logs.model";
import inventoryBatchLogsService, { InventoryBatchLogsService } from "./inventory-batch-logs.service";
import { Request, Response } from 'express';

class InventoryBatchLogsController extends BaseController<InventoryBatchLogs, InventoryBatchLogsService> {
    constructor() { super(inventoryBatchLogsService)
      this.registerCustomRoutes()
        
     }

     protected registerCustomRoutes(): void {
  this.router.post("/scan/product", (req, res) => this.scanProduct(req, res))
}

     protected middlewaresFor() {
              return {
                index: [authenticate],
                create: [authenticate],
                update: [
                  authenticate,
                ],
                show: [authenticate],
                destroy: [authenticate],
                scanProduct: [authenticate]
              };
            }

              scanProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {unitBusinessId, productCode, inventoryBatchId, userId} = req.body

      await this.service.scanProduct(unitBusinessId, productCode, inventoryBatchId, userId)

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }
}
export default new InventoryBatchLogsController();