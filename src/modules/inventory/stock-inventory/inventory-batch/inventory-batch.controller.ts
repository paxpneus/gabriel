import { Request, Response } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import InventoryBatch from "./inventory-batch.model";
import inventoryBatchService, { InventoryBatchService } from "./inventory-batch.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";

class InventoryBatchController extends BaseController<InventoryBatch, InventoryBatchService> {
  constructor() {
    super(inventoryBatchService);
    this.registerCustomRoutes();
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],

      createInventoryBatch: [authenticate, userPermissions],
      createInventoryBatchDivergency: [authenticate, userPermissions],
      finishBatch: [authenticate, userPermissions],
      getFullBatch: [authenticate, userPermissions],
    };
  }

  private registerCustomRoutes(): void {
    this.router.post(
      "/create",
      ...this.mw("createInventoryBatch"),
      (req, res) => this.createInventoryBatch(req, res),
    );

    this.router.get(
      "/full/get",
      ...this.mw("getFullBatch"),
      (req, res) => this.getFullBatch(req, res),
    );

    this.router.post(
      "/finish/post",
      ...this.mw("finishBatch"),
      (req, res) => this.finishBatch(req, res),
    );

    this.router.post(
      "/create/divergency",
      ...this.mw("createInventoryBatchDivergency"),
      (req, res) => this.createInventoryBatchDivergency(req, res),
    );
  }

  createInventoryBatch = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { unitBusinessId, mode } = req.body;

      if (!unitBusinessId) {
        return res.status(400).json({ error: "Informe o unitBusinessId" });
      }

      const batch = await this.service.createInventoryBatch(
        unitBusinessId,
        mode,
      );
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  createInventoryBatchDivergency = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { parentBatchId } = req.body;

      if (!parentBatchId) {
        return res
          .status(400)
          .json({ error: "Informe o lote de inventário" });
      }

      const batch = await this.service.createDivergencyBatch(parentBatchId);
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
        userId as string | undefined,
      );

      return res.json(batch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new InventoryBatchController();
