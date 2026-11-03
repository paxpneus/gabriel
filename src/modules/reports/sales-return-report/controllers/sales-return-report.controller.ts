import { Request, Response, Router } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { SalesInvoicedReportQuerySchema } from "../../sales-invoiced-report/controllers/sales-invoiced-report.controller";
import salesReturnReportService from "../services/main/sales-return-report/sales-return-report.service";

class SalesReturnReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
  }

  // Mesma validação de período do relatório faturado.
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
      const report = await salesReturnReportService.getReport({
        startDate: parsed.data.start_date,
        endDate: parsed.data.end_date,
      });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SalesReturnReportController();
