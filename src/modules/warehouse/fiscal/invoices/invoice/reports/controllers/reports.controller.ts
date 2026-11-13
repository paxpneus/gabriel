import { Request, Response } from "express";
import RouterController from "../../../../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import { getUserContext } from "../../../../../../../shared/query/get-logged-user";
import invoiceReportsService from "../services/reports.service";
import { extractUnitBusinessIdFromRequest, resolveUnitBusinessId } from "../../shared";

// Rotas dos relatórios de nota (produto, fornecedor, transferência); montado pelo invoice.routes.ts.
class ReportsController extends RouterController {
  constructor() {
    super();

    this.router.get(
      "/report/products",
      ...this.mw("getInvoiceProductReport"),
      this.getInvoiceProductReport,
    );

    this.router.get(
      "/report/supplier",
      ...this.mw("getInvoiceSupplierReport"),
      this.getInvoiceSupplierReport,
    );

    this.router.get(
      "/report/transfer",
      ...this.mw("getTransferInvoicesReport"),
      this.getTransferInvoicesReport,
    );
  }

  protected middlewaresFor() {
    return {
      getInvoiceProductReport: [authenticate, userPermissions],
      getInvoiceSupplierReport: [authenticate, userPermissions],
      getTransferInvoicesReport: [authenticate, userPermissions],
    };
  }

  // Relatório (sem paginação) das notas de transferência — mesmos filtros de
  // `listTransferInvoices`.
  getTransferInvoicesReport = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const unitBusinessId = extractUnitBusinessIdFromRequest(req);
      const data = await invoiceReportsService.getTransferInvoicesReport(
        params,
        unitBusinessId,
      );
      return res.json({ data });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  getInvoiceProductReport = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      const { rows, summary } = await invoiceReportsService.getInvoiceProductReport(
        params,
        unitBusinessId,
      );
      // `data` mantido no formato antigo; `summary` (totais da nota + desconto de fornecedor) é adicional.
      return res.json({ data: rows, summary });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };

  getInvoiceSupplierReport = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      const { rows, summary } = await invoiceReportsService.getInvoiceSupplierReport(
        params,
        unitBusinessId,
      );
      // `data` mantido no formato antigo; `summary` é adicional.
      return res.json({ data: rows, summary });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export default new ReportsController();
