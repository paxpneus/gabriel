import { QueryParams } from "../../../../../../shared/query/query.types";
import invoiceService from "../../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import { SaleTransferInvoiceReport } from "../../../models/sale-transfer-invoice-report.types";
import saleTransferInvoiceReportRepository, {
  SaleTransferInvoiceReportRepository,
} from "../../../repositories/main/sale-transfer-invoice-report/sale-transfer-invoice-report.repository";
import {
  buildReportRows,
  buildSummary,
} from "./sale-transfer-invoice-report.aggregation";

const toIdList = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : value ? String(value).split(",") : [])
    .map((id) => id.trim())
    .filter(Boolean);

export class SaleTransferInvoiceReportService {
  constructor(
    private readonly repository: SaleTransferInvoiceReportRepository = saleTransferInvoiceReportRepository,
  ) {}

  async getReport(
    params: QueryParams,
    unitBusinessId: string,
  ): Promise<SaleTransferInvoiceReport> {
    const {
      origin_unit_business_id: originUnitBusinessFilter,
      product_id: productFilter,
      ...invoiceFilters
    } = params.filters ?? {};

    const rows = await this.repository.findRows(
      { ...params, filters: invoiceFilters },
      invoiceService.getQueryConfig(),
      {
        unitBusinessId,
        type: params.filters?.type ?? "OUTGOING",
        originUnitBusinessIds: toIdList(originUnitBusinessFilter),
        productIds: toIdList(productFilter),
      },
    );

    const data = buildReportRows(rows);
    return { data, summary: buildSummary(data) };
  }
}

export default new SaleTransferInvoiceReportService();
