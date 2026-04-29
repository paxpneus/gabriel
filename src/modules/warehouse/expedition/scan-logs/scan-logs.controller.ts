import { authenticate } from '../../../../middlewares/auth-token';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionScanLog from './scan-logs.model';
import ExpeditionScanLogService from './scan-logs.service';
import { Request, Response } from 'express';
export class ExpeditionScanLogController extends BaseController<ExpeditionScanLog, typeof ExpeditionScanLogService> {
  constructor() {
    super(ExpeditionScanLogService);
    this.registerCustomRoutes()

  }

  protected registerCustomRoutes(): void {
  this.router.post("/scan/product", (req, res) => this.scanProduct(req, res))

  this.router.post("/scan/product/incoming", (req, res) => this.scanProductIncoming(req, res))

  this.router.post("/bulk-remove-logs", (req, res) => this.bulkRemoveScanLogsOutgoing(req, res))
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
        scanProduct: [authenticate],
        scanProductIncoming: [authenticate],
        bulkRemoveScanLogsOutgoing: [authenticate]
      };
    }

  scanProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {labelcode, productcode, batchId, userId} = req.body

      await this.service.scanProduct(labelcode, productcode, batchId, userId)

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }

    bulkRemoveScanLogsOutgoing = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {batchId, items} = req.body

      await this.service.bulkRemoveScanLogsOutgoing(batchId, items)

    return res.status(201).json({ message: "Produtos removidos com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }

    scanProductIncoming = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {labelcode, batchId, userId, quantity} = req.body

      await this.service.scanProductIncoming(labelcode, batchId, userId, quantity)

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }
}

export default new ExpeditionScanLogController();
