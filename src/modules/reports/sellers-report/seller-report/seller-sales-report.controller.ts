import { Request, Response, Router } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import SellerSalesReportService from "./seller-sales-report.service";
import { userPermissions } from "../../../../middlewares/user-permissions";

class SellerSalesReportController {
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
    const report = await SellerSalesReportService.getReport({
      startDate: String(req.query.startDate ?? req.query.start_date ?? ""),
      endDate: String(req.query.endDate ?? req.query.end_date ?? ""),
      sellerId: (req.query.sellerId ?? req.query.seller_id) as
        | string
        | undefined,
      productId: (req.query.productId ?? req.query.product_id) as
        | string
        | undefined,
      brand: req.query.brand as string | undefined,
      tireMeasure: (req.query.tireMeasure ?? req.query.tire_measure) as
        | string
        | undefined,
      customerId: (req.query.customerId ?? req.query.customer_id) as
        | string
        | undefined,
      unitBusinessId: (req.query.unitBusinessId ?? req.query.unit_business_id) as
        | string
        | undefined,
      drillDown: req.query.drillDown === "true",
    });

    return res.json(report);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

  jobStatus = async (_req: Request, res: Response): Promise<Response> => {
    try {
      const status = await SellerSalesReportService.getJobStatus();
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

    SellerSalesReportService.runIncrementalJob()
      .then((result) => {
        console.log(
          "[SellerSalesReport] Job finalizado com sucesso:",
          result,
        );
      })
      .catch((error) => {
        console.error(
          "[SellerSalesReport] Job falhou:",
          error?.message ?? error,
        );
      });

    return res;
  };
}

export default new SellerSalesReportController();