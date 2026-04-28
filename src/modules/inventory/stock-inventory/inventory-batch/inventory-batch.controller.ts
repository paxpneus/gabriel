import { Request, Response } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import InventoryBatch from "./inventory-batch.model";
import inventoryBatchService, { InventoryBatchService } from "./inventory-batch.service";
import { authenticate } from "../../../../middlewares/auth-token";

class InventoryBatchController extends BaseController<InventoryBatch, InventoryBatchService> {
  constructor() {
    super(inventoryBatchService);
    this.registerCustomRoutes();
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
          createInventoryBatch: [authenticate],
          finishBatch: [authenticate],
          getFullBatch: [authenticate],
        };
      }

  private registerCustomRoutes(): void {
    this.router.post("/create", (req, res) => this.createInventoryBatch(req, res));

    this.router.get("/full/get", (req, res) => this.getFullBatch(req, res));

    this.router.post("/finish/post", (req, res) => this.finishBatch(req, res))
  }

  createInventoryBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { unitBusinessId } = req.body;

      if (!unitBusinessId) {
        return res.status(400).json({ error: "Informe o unitBusinessId" });
      }

      const batch = await this.service.createInventoryBatch(unitBusinessId);
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

   finishBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { batchId } = req.body;

      if (!batchId) {
        return res.status(400).json({ error: "Lote não encontrado!" });
      }

      const batch = await this.service.finishBatch(batchId);
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  getFullBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { batchId, number, userId } = req.query;

      if (!batchId && !number) {
        return res.status(400).json({ error: "Informe batchId ou number" });
      }

      const batch = await this.service.findByIdFullBatch(
        batchId as string | undefined,
        number as string | undefined,
        userId as string | undefined
      );

      return res.json(batch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };


}

export default new InventoryBatchController();