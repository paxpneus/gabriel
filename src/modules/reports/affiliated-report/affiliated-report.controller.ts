import { Response, Router } from "express";
import { authenticate, AuthRequest } from "../../../middlewares/auth-token";
import { ProductStockFlowQuerySchema } from "../product-stock-flow/controllers/product-stock-flow.controller";
import affiliatedReportService from "./affiliated-report.service";

// Sem userPermissions: o papel Afiliado não tem permissão nenhuma; o acesso é o contato afiliado do próprio usuário (service).
class AffiliatedReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, this.index);
  }

  /** GET / — vendas e comissão do afiliado logado no período (start_date/end_date, mesmo formato do stock flow). */
  index = async (req: AuthRequest, res: Response): Promise<Response> => {
    const parsed = ProductStockFlowQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    // Token de application não tem usuário: não é afiliado.
    const userId = req.user?.id;
    if (!userId) return res.status(403).json({ error: "Usuário sem acesso a este relatório" });

    try {
      const report = await affiliatedReportService.getReport(
        userId,
        parsed.data.start_date,
        parsed.data.end_date,
      );
      if (!report) return res.status(403).json({ error: "Usuário sem acesso a este relatório" });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new AffiliatedReportController();
