import { Request, Response, Router } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import SellerSalesReportService from "./seller-sales-report.service";
import { userPermissions } from "../../../../middlewares/user-permissions";

// Normaliza um valor de query string em array de strings.
// Aceita: undefined, string única, "a,b,c" (CSV) ou array já parseado pelo qs
// (ex: ?sellerIds=a&sellerIds=b ou ?sellerIds[]=a&sellerIds[]=b).
function toQueryArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value === "string") {
    const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  }

  return undefined;
}

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
        userId: (req.query.userId ?? undefined) as string | undefined,
        sellerIds: toQueryArray(req.query.sellerIds ?? req.query.seller_ids),
        productIds: toQueryArray(req.query.productIds ?? req.query.product_ids),
        brandIds: toQueryArray(req.query.brandIds ?? req.query.brand_ids),
        tireMeasure: (req.query.tireMeasure ?? req.query.tire_measure) as
          | string
          | undefined,
        customerIds: toQueryArray(req.query.customerIds ?? req.query.customer_ids),
        unitBusinessIds: toQueryArray(
          req.query.unitBusinessIds ?? req.query.unit_business_ids,
        ),
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