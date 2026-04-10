import BaseController from "../../../shared/utils/base-models/base-controller";
import Integration from "./integrations.model";
import integrationService, { IntegrationService } from "./integrations.service";
import { Request, Response } from "express";
class IntegrationController extends BaseController<
  Integration,
  IntegrationService
> {
  constructor() {
    super(integrationService);

    this.router.post(
        `/mark-lock-orders`, this.markLockOrdersToday
    )
  }

  markLockOrdersToday = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { name } = req.body;
      const lockresponse = await this.service.markLockOrdersToday(name);
      return res.json({
        message: `Trava de pedidos na integração ${lockresponse == true ? 'Habilitado' : 'Desabilitado'} `,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error.message,
      });
    }
  };
}
export default new IntegrationController();
