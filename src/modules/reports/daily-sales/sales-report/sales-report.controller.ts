import { Request, Response, Router } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import SalesReportService from "./sales-report.service";
import { userPermissions } from "../../../../middlewares/user-permissions";
import User from "../../../company/users/users/user.model";

class SalesReportController {
  public router: Router;

  constructor() {
    this.router = Router();
    this.router.get("/", authenticate, userPermissions, this.index);
    this.router.post("/run", authenticate, userPermissions, this.runJob);
    this.router.get(
      "/job-status",
      authenticate,
      userPermissions,
      this.jobStatus,
    );
  }

  index = async (req: Request, res: Response): Promise<Response> => {
  try {
    const report = await SalesReportService.getReport({
      dateFrom: String(req.query.dateFrom ?? req.query.date_from ?? ""),
      dateTo: String(req.query.dateTo ?? req.query.date_to ?? ""),
      unitBusinessId: (req.query.unitBusinessId ?? req.query.unit_business_id) as string | undefined,
      unitBusinessIds: (req.query.unitBusinessIds ?? req.query.unit_business_ids) as string[] | undefined,
      storeId: (req.query.storeId ?? req.query.store_id) as string | undefined,
      state: (req.query.state ?? req.query.destination_uf) as string | undefined,
      productId: (req.query.productId ?? req.query.product_id) as string | undefined,
      sku: req.query.sku as string | undefined,
      statusId: (req.query.statusId ?? req.query.status_id) as string | undefined,
      drillDown: req.query.drillDown === "true",
    });

    return res.json(report);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

  jobStatus = async (_req: Request, res: Response): Promise<Response> => {
    try {
      const status = await SalesReportService.getJobStatus();
      return res.json(status);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  runJob = async (_req: Request, res: Response): Promise<Response> => {
    res.status(202).json({
      message:
        "os dados estão sendo processados, isso pode levar alguns minutos. Favor atualizar página novamente em breve para ver o resultado do relatório.",
    });

    SalesReportService.runIncrementalJob()
      .then((result) => {
        console.log("[SalesReport] Job finalizado com sucesso:", result);
      })
      .catch((error) => {
        console.error("[SalesReport] Job falhou:", error?.message ?? error);
      });

    return res;
  };
}

export default new SalesReportController();
