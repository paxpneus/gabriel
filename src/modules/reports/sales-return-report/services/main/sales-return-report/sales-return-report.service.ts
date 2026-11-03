import {
  endOfDayTz,
  startOfDayTz,
} from "../../../../../../shared/utils/normalizers/date";
import unitBusinessService, {
  CD21_UNIT_BUSINESS_NUMBER,
} from "../../../../../company/unit-business/unit-business.service";
import {
  SalesReturnReport,
  SalesReturnReportParams,
} from "../../../models/sales-return-report.types";
import salesReturnReportRepository, {
  SalesReturnReportRepository,
} from "../../../repositories/main/sales-return-report/sales-return-report.repository";
import { buildReportRows, buildSummary } from "./sales-return-report.aggregation";

export class SalesReturnReportService {
  constructor(
    private readonly repository: SalesReturnReportRepository = salesReturnReportRepository,
  ) {}

  /** Devoluções do CD21 pelos movimentos do Kardex (mesma base e valor do stock flow), com dados da venda de origem quando houver. */
  async getReport(params: SalesReturnReportParams): Promise<SalesReturnReport> {
    const store = await unitBusinessService.findOne({
      where: { number: CD21_UNIT_BUSINESS_NUMBER },
      attributes: ["id"],
    });
    if (!store) throw new Error("Unidade CD21 (Loja 21) não cadastrada");

    const movementIds = await this.repository.findReturnMovementIds(
      store.id,
      startOfDayTz(params.startDate).toDate(),
      endOfDayTz(params.endDate).toDate(),
    );
    const lines = await this.repository.findReturnLines(movementIds);

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        unit_business_id: store.id,
      },
      rows: buildReportRows(lines),
      summary: buildSummary(lines),
    };
  }
}

export default new SalesReturnReportService();
