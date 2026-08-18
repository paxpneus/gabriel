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

    this.router.put(
      "/:id/with-options",
      ...this.mw("updateWithOptions"),
      this.updateWithOptions,
    );
  }
  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      updateWithOptions: [authenticate, userPermissions],
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

   index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const result = await this.service.paginateWithOptions(params);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
   }

    updateWithOptions = async (req: Request, res: Response): Promise<Response> => {
      try {
        const {category, options} = req.body

        if (!req.params.id) throw new Error("Categoria não encontrada") 

          console.log(category, options, req.params.id)

        const records = await this.service.updateWithOptions(req.params.id as string, category, options)
      return res.json(records);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
    
  };
}
export default new CategoryController();
