import { Request, Response, Router } from "express";
import { z } from "zod";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { ProductStockFlowQuerySchema } from "../../product-stock-flow/controllers/product-stock-flow.controller";
import sellerCommissionReportService from "../services/main/seller-commission-report/seller-commission-report.service";

// Um id ou vários (`campo[]=`).
const uuidList = (message: string) =>
  z
    .union([z.uuid(message), z.array(z.uuid(message))])
    .optional()
    .transform((value) => (value === undefined ? undefined : [value].flat()));

// Período e marca (uma ou `brand[]=`) iguais ao stock flow; produto, vendedor e gerente = um id ou vários.
export const SellerCommissionReportQuerySchema = ProductStockFlowQuerySchema.and(
  z.object({
    product_id: uuidList("Produto inválido"),
    seller_id: uuidList("Vendedor inválido"),
    manager_id: uuidList("Gerente inválido"),
  }),
);

class SellerCommissionReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    const parsed = SellerCommissionReportQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      brand: req.query.brand,
      product_id: req.query.product_id,
      seller_id: req.query.seller_id,
      manager_id: req.query.manager_id,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    try {
      const report = await sellerCommissionReportService.getReport({
        startDate: parsed.data.start_date,
        endDate: parsed.data.end_date,
        brands: parsed.data.brand,
        productIds: parsed.data.product_id,
        sellerIds: parsed.data.seller_id,
        managerIds: parsed.data.manager_id,
      });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SellerCommissionReportController();
