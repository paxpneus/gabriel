import BaseController from "../../../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import Category from "./categories.model";
import categoryService, { CategoryService } from "./categories.service";
import { Request, Response } from "express";
export class CategoryController extends BaseController<
  Category,
  CategoryService
> {
  constructor() {
    super(categoryService);
  }
  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

    show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.findByIdWithOptions(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}
export default new CategoryController();
