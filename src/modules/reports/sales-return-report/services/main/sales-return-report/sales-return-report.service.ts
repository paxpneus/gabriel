import { cachedReport, REPORT_CACHE_NAMES } from "../../../../helpers/report-cache";
import { Op } from "sequelize";
import {
  endOfDayTz,
  startOfDayTz,
} from "../../../../../../shared/utils/normalizers/date";
import unitBusinessService, {
  CD21_UNIT_BUSINESS_NUMBER,
} from "../../../../../company/unit-business/unit-business.service";
import productService from "../../../../../inventory/products/services/product.service";
import {
  NFE_RETURN_PURPOSE,
  readNfeIde,
} from "../../../../../warehouse/fiscal/invoices/invoice/helpers/nfe-ide";
import {
  SalesReturnData,
  SalesReturnReport,
  SalesReturnReportParams,
} from "../../../models/sales-return-report.types";
import salesReturnReportRepository, {
  SalesReturnReportRepository,
} from "../../../repositories/main/sales-return-report/sales-return-report.repository";
import {
  buildReportRows,
  buildSummary,
  movementsWithoutInvoice,
} from "./sales-return-report.aggregation";

export class SalesReturnReportService {
  constructor(
    private readonly repository: SalesReturnReportRepository = salesReturnReportRepository,
  ) {}

  /** getReport com cache Redis de 1h por filtro; refresh=true recalcula e regrava (rota /refresh). */
  async getCachedReport(params: SalesReturnReportParams, refresh = false) {
    return cachedReport(REPORT_CACHE_NAMES.salesReturnReport, params, () => this.getReport(params), refresh);
  }

  /** Devoluções do CD21 pelos movimentos do Kardex (mesma base e valor do stock flow), com dados da venda de origem quando houver. */
  async getReport(params: SalesReturnReportParams): Promise<SalesReturnReport> {
    // Marca vira lista de product_id (como no stock flow); com produto também, fica a interseção.
    let productIds = params.productIds?.length ? params.productIds : undefined;
    if (params.brands?.length) {
      const brandProducts = await productService.findAll({
        where: { brand: { [Op.in]: params.brands } },
        attributes: ["id"],
      });
      const brandProductIds = brandProducts.map((product) => product.id);
      productIds = productIds
        ? productIds.filter((id) => brandProductIds.includes(id))
        : brandProductIds;
    }

    const { unitBusinessId, lines, invoicesWithoutMovement } = await this.findReturns(
      params.startDate,
      params.endDate,
      productIds,
    );

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        unit_business_id: unitBusinessId,
        brand: params.brands?.length ? params.brands : null,
        product_id: params.productIds?.length ? params.productIds : null,
      },
      rows: buildReportRows(lines),
      summary: buildSummary(lines),
      warnings: {
        movements_without_invoice: movementsWithoutInvoice(lines),
        invoices_without_movement: invoicesWithoutMovement.length,
      },
    };
  }

  /** Movimentos de devolução do CD21 no período (enriquecidos) e NF de devolução sem movimento; também lido pelo relatório de problemas de integração. */
  async findReturns(
    startDate: string,
    endDate: string,
    productIds?: string[],
  ): Promise<SalesReturnData> {
    const store = await unitBusinessService.findOne({
      where: { number: CD21_UNIT_BUSINESS_NUMBER },
      attributes: ["id"],
    });
    if (!store) throw new Error("Unidade CD21 (Loja 21) não cadastrada");

    const start = startOfDayTz(startDate).toDate();
    const end = endOfDayTz(endDate).toDate();
    const [movementIds, candidates] = await Promise.all([
      this.repository.findReturnMovementIds(store.id, start, end, productIds),
      this.repository.findReturnInvoiceCandidatesWithoutMovement(store.id, start, end, productIds),
    ]);
    const lines = await this.repository.findReturnLines(movementIds);
    // Só conta como devolução sem movimento a nota com finNFe = 4 no XML (entrada própria normal fica fora).
    const invoicesWithoutMovement = candidates.filter(
      (candidate) => readNfeIde(candidate.xml_head)?.purpose === NFE_RETURN_PURPOSE,
    );
    return { unitBusinessId: store.id, lines, invoicesWithoutMovement };
  }
}

export default new SalesReturnReportService();
