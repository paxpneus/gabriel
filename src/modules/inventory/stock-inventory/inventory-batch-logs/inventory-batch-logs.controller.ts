import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import InventoryBatchLogs from "./inventory-batch-logs.model";
import inventoryBatchLogsService, {
  InventoryBatchLogsService,
} from "./inventory-batch-logs.service";
import { Request, Response } from "express";

class InventoryBatchLogsController extends BaseController<
  InventoryBatchLogs,
  InventoryBatchLogsService
> {
  constructor() {
    super(inventoryBatchLogsService);
    this.registerCustomRoutes();
  }

  protected registerCustomRoutes(): void {
    this.router.post(
      "/scan/product",
      ...this.mw("scanProduct"),
      (req, res) => this.scanProduct(req, res),
    );
    this.router.put(
      "/update/quantity",
      ...this.mw("updateLogQuantity"),
      (req, res) => this.updateLogQuantity(req, res),
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      scanProduct: [authenticate, userPermissions],
      updateLogQuantity: [authenticate, userPermissions],
    };
  }

  scanProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {
        unitBusinessId,
        productCode,
        inventoryBatchId,
        userId,
        quantity,
      } = req.body;

      const response = await this.service.scanProduct(
        unitBusinessId,
        productCode,
        inventoryBatchId,
        userId,
        quantity,
      );

      return res.status(201).json(response);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  updateLogQuantity = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {
        logId,
        userId,
        newQuantity,
      } = req.body;

      await this.service.updateLogQuantity(
        logId,
        userId,
        newQuantity,
      );

      return res.status(201).json({ message: "Produto escaneado com sucesso" });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}
export default new InventoryBatchLogsController();
