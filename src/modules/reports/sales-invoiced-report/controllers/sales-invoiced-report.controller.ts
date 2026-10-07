import { Request, Response, Router } from "express";
import { z } from "zod";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import salesInvoicedReportService from "../services/main/sales-invoiced-report/sales-invoiced-report.service";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateField = (label: string) =>
  z
    .string({ error: `${label} é obrigatória` })
    .regex(DATE_PATTERN, `${label} deve estar no formato YYYY-MM-DD`)
    .refine(
      (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
      `${label} inválida`,
    );

export const SalesInvoicedReportQuerySchema = z
  .object({
    start_date: dateField("Data inicial"),
    end_date: dateField("Data final"),
  })
  .refine((query) => query.start_date <= query.end_date, {
    message: "Data inicial não pode ser posterior à data final",
    path: ["start_date"],
  });

class SalesInvoicedReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
  }

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
      const report = await salesInvoicedReportService.getReport({
        startDate: parsed.data.start_date,
        endDate: parsed.data.end_date,
      });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SalesInvoicedReportController();
