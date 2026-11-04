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
  }

  // Só período (mesma validação do relatório de faturado).
  index = async (req: Request, res: Response): Promise<Response> => {
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
      const report = await integrationProblemsReportService.getReport({
        startDate: parsed.data.start_date,
        endDate: parsed.data.end_date,
      });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new IntegrationProblemsReportController();
