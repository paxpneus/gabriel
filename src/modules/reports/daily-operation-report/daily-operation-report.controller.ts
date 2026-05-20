import { Request, Response, Router } from "express";
import { authenticate } from "../../../middlewares/auth-token";
import DailyOperationReportService from "./daily-operation-report.service";

class DailyOperationReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, this.index);
    this.router.post("/run", authenticate, this.runJob);
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const report = await DailyOperationReportService.getReport({
        date: String(req.query.date ?? req.query.data ?? ""),
        unitBusinessId: (req.query.unitBusinessId ??
          req.query.unit_business_id) as string | undefined,
        transporterId: (req.query.transporterId ??
          req.query.transporter_id) as string | undefined,
        drillDown: req.query.drillDown === "true",
      });

      return res.json(report);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  runJob = async (_req: Request, res: Response): Promise<Response> => {
    try {
      const result = await DailyOperationReportService.runIncrementalJob();
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new DailyOperationReportController();
