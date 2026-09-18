import { authenticate, AuthRequest } from '../../../../middlewares/auth-token';
import { userPermissions } from '../../../../middlewares/user-permissions';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import { getUserContext } from '../../../../shared/query/get-logged-user';
import UnitBusiness from '../../../company/unit-business/unit-business.model';
import ExpeditionScanLog from './scan-logs.model';
import ExpeditionScanLogService from './scan-logs.service';
import { Request, Response } from 'express';
export class ExpeditionScanLogController extends BaseController<ExpeditionScanLog, typeof ExpeditionScanLogService> {
  constructor() {
    super(ExpeditionScanLogService);
    this.registerCustomRoutes()

  }

  protected registerCustomRoutes(): void {
  this.router.post("/scan/product", ...this.mw("scanProduct"), (req, res) => this.scanProduct(req, res))

  this.router.post("/scan/product/incoming", ...this.mw("scanProductIncoming"), (req, res) => this.scanProductIncoming(req, res))

  this.router.post("/scan/product/incoming/by-invoice", ...this.mw("scanProductIncomingByInvoice"), (req, res) => this.scanProductIncomingByInvoice(req, res))

  this.router.post("/scan/product/by-invoice", ...this.mw("scanProductByInvoice"), (req, res) => this.scanProductByInvoice(req, res))

  this.router.post("/bulk-remove-logs", ...this.mw("bulkRemoveScanLogsOutgoing"), (req, res) => this.bulkRemoveScanLogsOutgoing(req, res))

   this.router.post("/bulk-remove-logs-incoming", ...this.mw("bulkRemoveScanLogsIncoming"), (req, res) => this.bulkRemoveScanLogsIncoming(req, res))
}

  protected middlewaresFor() {
      return {
        index: [authenticate, userPermissions],
        create: [authenticate, userPermissions],
        update: [
          authenticate,
          userPermissions
        ],
        show: [authenticate, userPermissions],
        destroy: [authenticate, userPermissions],
        scanProduct: [authenticate, userPermissions],
        scanProductIncoming: [authenticate, userPermissions],
        scanProductByInvoice: [authenticate, userPermissions],
        scanProductIncomingByInvoice: [authenticate, userPermissions],
        bulkRemoveScanLogsOutgoing: [authenticate, userPermissions],
        bulkRemoveScanLogsIncoming: [authenticate, userPermissions]
      };
    }

    private async getUnitBusiness(req: Request) {
  const { unitBusinessId } = await getUserContext(req);

  return UnitBusiness.findByPk(unitBusinessId, {
    attributes: ['cnpj', 'transshipment_allowed'],
  });
}

  scanProduct = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { labelcode, productcode, batchId } = req.body;
    const { userId } = await getUserContext(req);
    const unitBusiness = await this.getUnitBusiness(req);

    await this.service.scanProduct(labelcode, productcode, batchId, userId, unitBusiness);

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

    bulkRemoveScanLogsOutgoing = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {batchId, items} = req.body

      await this.service.bulkRemoveScanLogsOutgoing(batchId, items)

    return res.status(201).json({ message: "Produtos removidos com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }

    bulkRemoveScanLogsIncoming = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {batchId, items} = req.body

      await this.service.bulkRemoveScanLogsIncoming(batchId, items)

    return res.status(201).json({ message: "Produtos removidos com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }

    scanProductIncoming = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { labelcode, batchId, quantity } = req.body;
    const { userId } = await getUserContext(req);
    const unitBusiness = await this.getUnitBusiness(req);

    await this.service.scanProductIncoming(labelcode, batchId, userId, quantity, unitBusiness );

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

  scanProductIncomingByInvoice = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { productId, batchId, invoiceId, quantity } = req.body;
    const roleId = (req as AuthRequest).user?.role;
    const unitBusiness = await this.getUnitBusiness(req);

    await this.service.scanProductIncomingByInvoice(productId, batchId, invoiceId, quantity, unitBusiness, roleId as string);

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

  scanProductByInvoice = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { productId, batchId, invoiceId, quantity } = req.body;
    const roleId = (req as AuthRequest).user?.role;
    const unitBusiness = await this.getUnitBusiness(req);

    await this.service.scanProductByInvoice(productId, batchId, invoiceId, quantity, unitBusiness, roleId as string);

    return res.status(201).json({ message: "Produto escaneado com sucesso" });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
}

export default new ExpeditionScanLogController();
