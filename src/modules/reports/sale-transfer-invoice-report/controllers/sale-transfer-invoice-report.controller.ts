import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import RouterController from "../../../../shared/utils/base-models/base-router-controller";
import { getUserContext } from "../../../../shared/query/get-logged-user";
import saleTransferInvoiceReportService from "../services/main/sale-transfer-invoice-report/sale-transfer-invoice-report.service";

class SaleTransferInvoiceReportController extends RouterController {
  constructor() {
    super();
    this.router.get("/", authenticate, userPermissions, this.index);
  }

  // Mesma leitura do relatório de produtos de invoice: ?unitBusinessId= ou filters[unit_business_id], senão a loja do usuário.
  private async resolveUnitBusinessId(req: Request): Promise<string> {
    const filtersUnitBusinessId = (
      req.query.filters as Record<string, unknown> | undefined
    )?.unit_business_id;
    const fromRequest = (req.query.unitBusinessId ??
      (typeof filtersUnitBusinessId === "string"
        ? filtersUnitBusinessId
        : undefined)) as string | undefined;

    if (fromRequest?.trim()) return fromRequest;
    return (await getUserContext(req)).unitBusinessId;
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const report = await saleTransferInvoiceReportService.getReport(
        this.extractQueryParams(req),
        await this.resolveUnitBusinessId(req),
      );
      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SaleTransferInvoiceReportController();
