import { Request, Response } from "express";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController from "../../../shared/utils/base-models/base-controller";
import SupplierDiscountRule from "./supplier-discount-rule.model";
import SupplierDiscountRuleService from "./supplier-discount-rule.service";

export class SupplierDiscountRuleController extends BaseController<
  SupplierDiscountRule,
  typeof SupplierDiscountRuleService
> {
  constructor() {
    super(SupplierDiscountRuleService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
    };
  }

  // index/show sobrescritos pra sempre trazer o escopo (marca/aro/medida/
  // loja) já achatado em *_ids — ver findDetailedById/paginateDetailed em
  // supplier-discount-rule.service.ts.
  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const result = await this.service.paginateDetailed(params);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.findDetailedById(
        req.params.id as string,
      );
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SupplierDiscountRuleController();
