import salesReturnReportService from "../../../../sales-return-report/services/main/sales-return-report/sales-return-report.service";
import sellerCommissionReportService from "../../../../seller-commission-report/services/main/seller-commission-report/seller-commission-report.service";
import {
  IntegrationProblemsReport,
  IntegrationProblemsReportParams,
} from "../../../models/integration-problems-report.types";
import {
  buildReport,
  returnProblems,
  saleProblems,
} from "./integration-problems-report.aggregation";

export class IntegrationProblemsReportService {
  /** Divergências nota fiscal × Kardex do CD21 no período, nas saídas (base do relatório de comissão) e nas devoluções. */
  async getReport(params: IntegrationProblemsReportParams): Promise<IntegrationProblemsReport> {
    const [sales, returns] = await Promise.all([
      sellerCommissionReportService.findSaleInvoices(params.startDate, params.endDate),
      salesReturnReportService.findReturns(params.startDate, params.endDate),
    ]);

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        unit_business_id: sales.unitBusinessId,
      },
      ...buildReport([
        ...saleProblems(sales.invoices, sales.withoutMovement),
        ...returnProblems(returns.lines, returns.invoicesWithoutMovement),
      ]),
    };
  }
}

export default new IntegrationProblemsReportService();
