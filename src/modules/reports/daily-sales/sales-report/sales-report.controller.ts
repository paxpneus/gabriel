import { Request, Response, Router } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import SalesReportService from "./sales-report.service";

class SalesReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, this.index);
    this.router.post("/run", authenticate, this.runJob);
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const report = await SalesReportService.getReport({
        dateFrom: String(req.query.dateFrom ?? req.query.date_from ?? ""),
        dateTo: String(req.query.dateTo ?? req.query.date_to ?? ""),
        unitBusinessId: (req.query.unitBusinessId ??
          req.query.unit_business_id) as string | undefined,
        storeId: (req.query.storeId ?? req.query.store_id) as
          | string
          | undefined,
        state: (req.query.state ?? req.query.destination_uf) as
          | string
          | undefined,
        productId: (req.query.productId ?? req.query.product_id) as
          | string
          | undefined,
        sku: req.query.sku as string | undefined,
        statusId: (req.query.statusId ?? req.query.status_id) as
          | string
          | undefined,
        drillDown: req.query.drillDown === "true",
      });

      return res.json(report);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  runJob = async (_req: Request, res: Response): Promise<Response> => {
    try {
      const result = await SalesReportService.runIncrementalJob();
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SalesReportController();
