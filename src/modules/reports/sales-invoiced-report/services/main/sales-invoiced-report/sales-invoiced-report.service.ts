import { getBlingIntegration } from "../../../../../handlers/bling/api/bling_api.service";
import {
  SalesInvoicedReport,
  SalesInvoicedReportParams,
} from "../../../models/sales-invoiced-report.types";
import salesInvoicedReportRepository, {
  SalesInvoicedReportRepository,
} from "../../../repositories/main/sales-invoiced-report/sales-invoiced-report.repository";
import { INVOICED_STATUSES } from "../../../repositories/query-objects/sales-invoiced-report.filters";
import {
  buildReportRows,
  buildSummary,
  computeOrderVolumes,
} from "./sales-invoiced-report.aggregation";

export class SalesInvoicedReportService {
  constructor(
    private readonly repository: SalesInvoicedReportRepository = salesInvoicedReportRepository,
  ) {}

  async getReport(
    params: SalesInvoicedReportParams,
  ): Promise<SalesInvoicedReport> {
    const integration = await getBlingIntegration("Bling");
    const { startDate, endDate } = params;

    const [items, totals] = await Promise.all([
      this.repository.findRows(integration.id, startDate, endDate),
      this.repository.aggregateTotals(integration.id, startDate, endDate),
    ]);

    const volumesByOrder = computeOrderVolumes(items);

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        statuses: INVOICED_STATUSES,
      },
      rows: buildReportRows(items, volumesByOrder),
      summary: buildSummary(totals, volumesByOrder),
    };
  }
}

export default new SalesInvoicedReportService();
