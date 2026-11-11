import { Request, Response, Router } from "express";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import { AffiliatesReportQuerySchema } from "./schemas/affiliates-report.schema";
import affiliatesReportService from "./affiliates-report.service";

// Permissão própria (affiliates_report) e /refresh com report_refresh, ambas pelo CUSTOM_ROUTE_MAP (pasta sem .model.ts).
class AffiliatesReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
    this.router.post("/refresh", authenticate, userPermissions, this.refresh);
  }

  // GET / com cache de 1h; POST /refresh = mesmo contrato, ignora o cache, recalcula e regrava.
  index = (req: Request, res: Response) => this.respond(req, res, false);
  refresh = (req: Request, res: Response) => this.respond(req, res, true);

  private respond = async (req: Request, res: Response, refresh: boolean): Promise<Response> => {
    const parsed = AffiliatesReportQuerySchema.safeParse({
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      affiliated_id: req.query.affiliated_id,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    try {
      const report = await affiliatesReportService.getCachedReport(
        {
          startDate: parsed.data.start_date,
          endDate: parsed.data.end_date,
          affiliatedIds: parsed.data.affiliated_id,
        },
        refresh,
      );
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new AffiliatesReportController();
