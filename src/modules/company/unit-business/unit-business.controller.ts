import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController from "../../../shared/utils/base-models/base-controller";
import UnitBusiness from "./unit-business.model";
import UnitBusinessService from "./unit-business.service";
import { Request, Response } from "express";

export class UnitBusinessController extends BaseController<
  UnitBusiness,
  typeof UnitBusinessService
> {
  constructor() {
    super(UnitBusinessService);

    this.router.get("/head-office/get", this.getHeadOffice);

    (this.router.get(
      "/all-unit-business/get",
      ...this.mw("viewAllUnitBusiness"),
      (req, res) => this.viewAllUnitBusiness(req, res),
    ),
      this.router.post(
        "/queues/shutdown",
        ...this.mw("shutdownQueues"),
        (req, res) => this.shutdownQueues(req, res),
      ));
  }

  protected middlewaresFor() {
    return {
      index: [authenticate],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate],
      destroy: [authenticate, userPermissions],
      getHeadOffice: [authenticate],
      viewAllUnitBusiness: [authenticate, userPermissions],
      shutdownQueues: [authenticate, userPermissions],
    };
  }

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;
      const result = await this.service.findByIdWithConfig(id as string);
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getHeadOffice = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.getHeadOffice();
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  viewAllUnitBusiness(req: Request, res: Response) {
    return res.json(true);
  }

  shutdownQueues = async (req: Request, res: Response): Promise<Response> => {
    try {
      const locals = req.app.locals;

      const queues = [
        locals.BlingOrderQueue,
        locals.CNPJQueue,
        locals.NfeQueue,
        locals.MLOrderSyncQueue,
        locals.BlingDirectUpsertQueue,
        locals.BlingApiFetchQueue,
        locals.BlingTokenRefreshQueue,
        locals.BlingMigrationQueue,
        locals.TCarMigrationQueue,
        locals.TCarUpsertQueue,
        locals.DailyOperationReportQueue,
        locals.DailySalesReportQueue,
        locals.AutoBackupQueue,
      ].filter(Boolean);

      await Promise.all(queues.map((q: any) => q.queue?.close()));

      return res.json({
        message: `${queues.length} filas desconectadas do Redis com sucesso.`,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new UnitBusinessController();
