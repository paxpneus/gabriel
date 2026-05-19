import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import BaseController from '../../../shared/utils/base-models/base-controller';
import UnitBusiness from './unit-business.model';
import UnitBusinessService from './unit-business.service';
import { Request, Response } from "express";

export class UnitBusinessController extends BaseController<UnitBusiness, typeof UnitBusinessService> {
  constructor() {
    super(UnitBusinessService);

    this.router.get('/head-office/get', this.getHeadOffice)

     this.router.get("/all-unit-business/get", ...this.mw("viewAllUnitBusiness"), (req, res) => this.viewAllUnitBusiness(req, res))
  }

   protected middlewaresFor() {
        return {
          index: [authenticate],
          create: [authenticate, userPermissions],
          update: [
            authenticate,
            userPermissions
          ],
          show: [authenticate],
          destroy: [authenticate, userPermissions],
          getHeadOffice: [authenticate],
          viewAllUnitBusiness: [authenticate, userPermissions]
        };
      }

  getHeadOffice = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.getHeadOffice();
      return res.json(record)
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }

   viewAllUnitBusiness(req: Request, res: Response) {
    return res.json(true);
  }
}

export default new UnitBusinessController();
