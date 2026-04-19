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
      const {labelcode, productcode, batchId, userId} = req.body

      await this.service.scanProduct(labelcode, productcode, batchId, userId)

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }
}

export default new ExpeditionScanLogController();
