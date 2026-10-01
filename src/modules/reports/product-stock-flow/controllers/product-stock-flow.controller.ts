import { Request, Response, Router } from "express";
import { z } from "zod";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import productStockFlowService from "../services/main/product-stock-flow/product-stock-flow.service";

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

export const ProductStockFlowQuerySchema = z
  .object({
    start_date: dateField("Data inicial"),
    end_date: dateField("Data final"),
  })
  .refine((query) => query.start_date <= query.end_date, {
    message: "Data inicial não pode ser posterior à data final",
    path: ["start_date"],
  });

class ProductStockFlowController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    const parsed = ProductStockFlowQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    try {
      const report = await productStockFlowService.getReport({
        startDate: parsed.data.start_date,
        endDate: parsed.data.end_date,
      });
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new ProductStockFlowController();
