import { cachedReport, REPORT_CACHE_NAMES } from "../helpers/report-cache";
import affiliatesReportRepository, { AffiliatesReportRepository } from "./affiliates-report.repository";
import { AffiliatesReport, AffiliatesReportAffiliate, AffiliatesReportParams } from "./affiliates-report.types";

// Valores em centavos e quantidade em 4 casas inteiras: somas sem resíduo de ponto flutuante.
const toCents = (value: string | number | null | undefined): number => Math.round(Number(value ?? 0) * 100);
const toQuantityUnits = (value: string | number | null | undefined): number => Math.round(Number(value ?? 0) * 10000);

// Relatório de afiliados do hub (não é o do próprio afiliado): vendas, lucro e comissão devida por afiliado.
export class AffiliatesReportService {
  constructor(private readonly repository: AffiliatesReportRepository = affiliatesReportRepository) {}

  /** getReport com cache Redis de 1h por filtro; refresh=true recalcula e regrava (rota /refresh); o job do sales report invalida. */
  async getCachedReport(params: AffiliatesReportParams, refresh = false) {
    return cachedReport(REPORT_CACHE_NAMES.affiliatesReport, params, () => this.getReport(params), refresh);
  }

  /** Uma linha por afiliado (zerada sem venda) e o summary somado em centavos. */
  async getReport(params: AffiliatesReportParams): Promise<AffiliatesReport> {
    const rows = await this.repository.findAffiliateTotals(params);

    const affiliates: AffiliatesReportAffiliate[] = rows.map((row) => ({
      affiliated_id: row.affiliated_id,
      affiliated_name: row.affiliated_name,
      coupon_codes: row.coupon_codes,
      sales_count: Number(row.sales_count),
      items_sold_count: toQuantityUnits(row.items_sold_count) / 10000,
      total_sold: toCents(row.total_sold) / 100,
      profit: toCents(row.profit) / 100,
      affiliated_comission: toCents(row.affiliated_comission) / 100,
      orders_not_invoiced: Number(row.orders_not_invoiced),
    }));

    // Pedido tem no máximo um afiliado (índice parcial em order_coupons): somar as linhas não conta pedido duas vezes.
    const totals = rows.reduce(
      (acc, row) => ({
        sales: acc.sales + Number(row.sales_count),
        quantity: acc.quantity + toQuantityUnits(row.items_sold_count),
        sold: acc.sold + toCents(row.total_sold),
        profit: acc.profit + toCents(row.profit),
        commission: acc.commission + toCents(row.affiliated_comission),
        notInvoiced: acc.notInvoiced + Number(row.orders_not_invoiced),
      }),
      { sales: 0, quantity: 0, sold: 0, profit: 0, commission: 0, notInvoiced: 0 },
    );

    return {
      filters: {
        start_date: params.startDate,
        end_date: params.endDate,
        affiliated_id: params.affiliatedIds?.length ? params.affiliatedIds : null,
      },
      summary: {
        affiliates_count: affiliates.length,
        affiliates_with_sales: affiliates.filter((affiliate) => affiliate.sales_count > 0).length,
        sales_count: totals.sales,
        items_sold_count: totals.quantity / 10000,
        total_sold: totals.sold / 100,
        profit: totals.profit / 100,
        affiliated_comission: totals.commission / 100,
        orders_not_invoiced: totals.notInvoiced,
      },
      affiliates,
    };
  }
}

export default new AffiliatesReportService();
