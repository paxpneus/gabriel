import { Request, Response, Router } from "express";
import { authenticate, AuthRequest } from "../../../../middlewares/auth-token";
import SellerSalesReportService from "./seller-sales-report.service";
import { userHasPermission, userPermissions } from "../../../../middlewares/user-permissions";
import userService from "../../../company/users/users/user.service";
import {
  FULL_ACCESS_USER_TYPES,
  MANAGER_USER_TYPE,
  SELLER_USER_TYPE,
} from "../../../../shared/constants/user-types";

// Permissão da visão completa (todos os vendedores), a mesma dos outros relatórios financeiros.
const FULL_REPORT_ENTITY = "financial-pdt";

// Escopo pelo usuário logado, nunca pelo ?userId do cliente: vendedor/gerente só o próprio; visão completa
// (com ?userId opcional pra ver como um vendedor) só admin/developer ou financial-pdt. null = sem acesso.
async function resolveReportUserId(req: AuthRequest): Promise<string | undefined | null> {
  const requestedUserId = (req.query.userId ?? undefined) as string | undefined;
  if (req.application) {
    return userHasPermission(req.application.role, FULL_REPORT_ENTITY, "read") ? requestedUserId : null;
  }

  const user: any = await userService.getMe(req.cookies?.token);
  const type = user.type ?? user.config?.type;
  if (type === SELLER_USER_TYPE || type === MANAGER_USER_TYPE) return user.id;
  if (FULL_ACCESS_USER_TYPES.includes(type) || userHasPermission(user.role, FULL_REPORT_ENTITY, "read")) {
    return requestedUserId;
  }
  return null;
}

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
      const userId = await resolveReportUserId(req as AuthRequest);
      if (userId === null) {
        return res.status(403).json({ error: "Usuário sem acesso a este relatório" });
      }

      const report = await SellerSalesReportService.getCachedReport({
        startDate: String(req.query.dateFrom ?? req.query.start_date ?? ""),
        endDate: String(req.query.dateTo ?? req.query.end_date ?? ""),
        userId,
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
        // Filtra pelo afiliado (contact) congelado em order_coupons.
        affiliatedIds: toQueryArray(req.query.affiliatedIds ?? req.query.affiliated_ids),
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