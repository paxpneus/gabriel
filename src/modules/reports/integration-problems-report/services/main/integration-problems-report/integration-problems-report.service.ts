import {
  endOfDayTz,
  startOfDayTz,
} from "../../../../../../shared/utils/normalizers/date";
import unitBusinessService, {
  CD21_UNIT_BUSINESS_NUMBER,
} from "../../../../../company/unit-business/unit-business.service";
import salesReturnReportService from "../../../../sales-return-report/services/main/sales-return-report/sales-return-report.service";
import {
  IntegrationProblemsReport,
  IntegrationProblemsReportParams,
} from "../../../models/integration-problems-report.types";
import integrationProblemsReportRepository, {
  IntegrationProblemsReportRepository,
} from "../../../repositories/main/integration-problems-report/integration-problems-report.repository";
import {
  buildReport,
  returnProblems,
  saleProblems,
} from "./integration-problems-report.aggregation";

export class IntegrationProblemsReportService {
  constructor(
    private readonly repository: IntegrationProblemsReportRepository = integrationProblemsReportRepository,
  ) {}

  /** Divergências nota fiscal × Kardex do CD21 no período, nas saídas (movimento → nota → pedido) e nas devoluções. */
  async getReport(params: IntegrationProblemsReportParams): Promise<IntegrationProblemsReport> {
    const store = await unitBusinessService.findOne({
      where: { number: CD21_UNIT_BUSINESS_NUMBER },
      attributes: ["id"],
    });
    if (!store) throw new Error("Unidade CD21 (Loja 21) não cadastrada");

    const start = startOfDayTz(params.startDate).toDate();
    const end = endOfDayTz(params.endDate).toDate();
    const [movementIds, withoutMovement, returns] = await Promise.all([
      this.repository.findSaleMovementIds(store.id, start, end),
      this.repository.findInvoicesWithoutMovement(store.id, start, end),
      salesReturnReportService.findReturns(params.startDate, params.endDate),
    ]);
    const invoices = await this.repository.findMovementInvoices(movementIds);

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        unit_business_id: store.id,
      },
      ...buildReport([
        ...saleProblems(invoices, withoutMovement),
        ...returnProblems(returns.lines, returns.invoicesWithoutMovement),
      ]),
    };
  }
}

export default new IntegrationProblemsReportService();
