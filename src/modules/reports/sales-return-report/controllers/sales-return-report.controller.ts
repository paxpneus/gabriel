import { Request, Response, Router } from "express";
import { z } from "zod";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { ProductStockFlowQuerySchema } from "../../product-stock-flow/controllers/product-stock-flow.controller";
import salesReturnReportService from "../services/main/sales-return-report/sales-return-report.service";

// Período e marca (uma ou `brand[]=`) iguais ao stock flow; produto = um id ou vários (`product_id[]=`).
export const SalesReturnReportQuerySchema = ProductStockFlowQuerySchema.and(
  z.object({
    product_id: z
      .union([z.uuid("Produto inválido"), z.array(z.uuid("Produto inválido"))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [value].flat())),
  }),
);

class SalesReturnReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    const parsed = SalesReturnReportQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      brand: req.query.brand,
      product_id: req.query.product_id,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    try {
      const report = await salesReturnReportService.getReport({
        startDate: parsed.data.start_date,
        endDate: parsed.data.end_date,
        brands: parsed.data.brand,
        productIds: parsed.data.product_id,
      });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SalesReturnReportController();
