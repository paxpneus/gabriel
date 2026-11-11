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

// Período e marca (uma ou `brand[]=`) iguais ao stock flow; produto, vendedor, gerente, loja e loja de origem = um id ou vários.
export const SellerCommissionReportQuerySchema = ProductStockFlowQuerySchema.and(
  z.object({
    product_id: uuidList("Produto inválido"),
    seller_id: uuidList("Vendedor inválido"),
    manager_id: uuidList("Gerente inválido"),
    unit_business_id: uuidList("Loja inválida"),
    origin_unit_business_id: uuidList("Loja de origem inválida"),
  }),
);

class SellerCommissionReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
    this.router.post("/refresh", authenticate, userPermissions, this.refresh);
  }

  // GET / com cache de 1h; POST /refresh (permissão "Atualizar relatórios") = mesmo contrato, ignora o cache, recalcula e regrava.
  index = (req: Request, res: Response) => this.respond(req, res, false);
  refresh = (req: Request, res: Response) => this.respond(req, res, true);

  private respond = async (req: Request, res: Response, refresh: boolean): Promise<Response> => {
    const parsed = SellerCommissionReportQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      brand: req.query.brand,
      product_id: req.query.product_id,
      seller_id: req.query.seller_id,
      manager_id: req.query.manager_id,
      unit_business_id: req.query.unit_business_id,
      origin_unit_business_id: req.query.origin_unit_business_id,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    try {
      const report = await sellerCommissionReportService.getCachedReport(
        {
          startDate: parsed.data.start_date,
          endDate: parsed.data.end_date,
          brands: parsed.data.brand,
          productIds: parsed.data.product_id,
          sellerIds: parsed.data.seller_id,
          managerIds: parsed.data.manager_id,
          unitBusinessIds: parsed.data.unit_business_id,
          originUnitBusinessIds: parsed.data.origin_unit_business_id,
        },
        refresh,
      );
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SellerCommissionReportController();
