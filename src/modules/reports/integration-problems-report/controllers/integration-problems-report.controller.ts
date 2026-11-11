import { Request, Response, Router } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { SalesInvoicedReportQuerySchema } from "../../sales-invoiced-report/controllers/sales-invoiced-report.controller";
import integrationProblemsReportService from "../services/main/integration-problems-report/integration-problems-report.service";

class IntegrationProblemsReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
    this.router.post("/refresh", authenticate, userPermissions, this.refresh);
  }

  // GET / com cache de 1h; POST /refresh (permissão "Atualizar relatórios") = mesmo contrato, ignora o cache, recalcula e regrava.
  index = (req: Request, res: Response) => this.respond(req, res, false);
  refresh = (req: Request, res: Response) => this.respond(req, res, true);

  // Só período (mesma validação do relatório de faturado).
  private respond = async (req: Request, res: Response, refresh: boolean): Promise<Response> => {
    const parsed = SalesInvoicedReportQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    try {
      const report = await integrationProblemsReportService.getCachedReport(
        { startDate: parsed.data.start_date, endDate: parsed.data.end_date },
        refresh,
      );
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new IntegrationProblemsReportController();
