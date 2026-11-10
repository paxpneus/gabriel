import { Op } from "sequelize";
import { contactService } from "../../sales/contacts";
import { AFFILIATED_CONTACT_TYPE } from "../../sales/contacts/contacts.types";
import contactCouponService from "../../sales/coupons/contact-coupons/contact-coupons.service";
import couponService from "../../sales/coupons/coupons/coupons.service";
import affiliatedReportRepository, { AffiliatedReportRepository } from "./affiliated-report.repository";
import {
  AffiliatedReport,
  AffiliatedReportEvolutionPoint,
  AffiliatedReportOrderRow,
  AffiliatedReportProduct,
  AffiliatedReportRankingProduct,
} from "./affiliated-report.types";

// Valores em centavos inteiros: somas sem resíduo de ponto flutuante.
const toCents = (value: string | number | null | undefined): number => Math.round(Number(value ?? 0) * 100);

// Quantidade numeric(14,4): soma sem resíduo de ponto flutuante.
const roundQuantity = (value: number): number => Math.round(value * 10000) / 10000;

// Segunda-feira da semana (YYYY-MM-DD), igual ao DATE_TRUNC('week') do seller report.
function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

// Pedido com valores em centavos, base de todas as somas do relatório.
interface OrderCents {
  row: AffiliatedReportOrderRow;
  gross: number;
  net: number;
  commission: number;
}

// Soma dos pedidos por período (dia/semana/mês), em ordem de data.
function evolutionBy(orders: OrderCents[], periodOf: (date: string) => string): AffiliatedReportEvolutionPoint[] {
  const byPeriod = new Map<string, { count: number; gross: number; net: number; commission: number }>();
  for (const order of orders) {
    const period = periodOf(order.row.order_date);
    const totals = byPeriod.get(period) ?? { count: 0, gross: 0, net: 0, commission: 0 };
    totals.count += 1;
    totals.gross += order.gross;
    totals.net += order.net;
    totals.commission += order.commission;
    byPeriod.set(period, totals);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, totals]) => ({
      period,
      orders_count: totals.count,
      gross_total: totals.gross / 100,
      discount_total: (totals.gross - totals.net) / 100,
      net_total: totals.net / 100,
      commission: totals.commission / 100,
    }));
}

// Produtos somados no período (item já rateado no snapshot pelo peso da comissão), mais vendido primeiro.
function productsOf(orders: OrderCents[]): AffiliatedReportProduct[] {
  const byProduct = new Map<string, { product: AffiliatedReportProduct; gross: number; net: number; commission: number }>();
  for (const item of orders.flatMap((order) => order.row.items)) {
    const key = item.product_id ?? `name:${item.name ?? ""}`;
    const entry = byProduct.get(key) ?? {
      product: {
        product_id: item.product_id,
        product_name: item.name,
        product_brand: item.brand,
        product_measure: item.measure,
        quantity: 0,
        gross_total: 0,
        discount_value: 0,
        net_total: 0,
        commission_value: 0,
      },
      gross: 0,
      net: 0,
      commission: 0,
    };
    entry.product.quantity = roundQuantity(entry.product.quantity + Number(item.quantity ?? 0));
    entry.gross += toCents(item.gross_total);
    entry.net += toCents(item.net_total);
    entry.commission += toCents(item.commission);
    byProduct.set(key, entry);
  }
  return [...byProduct.values()]
    .map(({ product, gross, net, commission }) => ({
      ...product,
      gross_total: gross / 100,
      discount_value: (gross - net) / 100,
      net_total: net / 100,
      commission_value: commission / 100,
    }))
    .sort((a, b) => b.quantity - a.quantity || (a.product_name ?? "").localeCompare(b.product_name ?? ""));
}

// Destaque do ranking com os números do produto no período; null sem produto.
function rankingProduct(product: AffiliatedReportProduct | null | undefined): AffiliatedReportRankingProduct | null {
  if (!product) return null;
  const { product_id, product_name, product_brand, product_measure, quantity, commission_value } = product;
  return { product_id, product_name, product_brand, product_measure, quantity, commission_value };
}

// Relatório do próprio afiliado logado (login de afiliado), na base do seller report.
export class AffiliatedReportService {
  constructor(private readonly repository: AffiliatedReportRepository = affiliatedReportRepository) {}

  /** Escopo pelo contato AFFILIATED do usuário logado (nunca por id do request); null = usuário não é afiliado. */
  async getReport(userId: string, startDate: string, endDate: string): Promise<AffiliatedReport | null> {
    const affiliate = await contactService.findOne({
      where: { user_id: userId, type: AFFILIATED_CONTACT_TYPE },
      attributes: ["id"],
    });
    if (!affiliate) return null;

    const [orderRows, links] = await Promise.all([
      this.repository.findOrders({ affiliatedId: affiliate.id, startDate, endDate }),
      contactCouponService.findAll({
        where: { contact_id: affiliate.id, active: true },
        attributes: ["coupon_id", "commission_rate"],
      }),
    ]);

    // Só cupom ativo gera comissão: vínculo ativo com cupom inativo fica de fora.
    let coupons: { id: string; code: string }[] = [];
    if (links.length) {
      coupons = await couponService.findAll({
        where: { id: { [Op.in]: links.map((link) => link.coupon_id) }, active: true },
        attributes: ["id", "code"],
      });
    }
    const codeById = new Map(coupons.map((coupon) => [coupon.id, coupon.code]));

    const orders: OrderCents[] = orderRows.map((row) => ({
      row,
      gross: toCents(row.gross_total),
      net: toCents(row.net_total),
      commission: toCents(row.commission),
    }));

    const sum = (list: OrderCents[], field: "gross" | "net" | "commission") =>
      list.reduce((total, order) => total + order[field], 0);
    const gross = sum(orders, "gross");
    const net = sum(orders, "net");
    // % de comissão só sobre faturados: não faturado ainda tem comissão 0 e puxaria a taxa pra baixo.
    const invoiced = orders.filter((order) => order.row.invoiced);
    const invoicedNet = sum(invoiced, "net");
    const commissionPct = invoicedNet ? Math.round((sum(invoiced, "commission") / invoicedNet) * 10000) / 100 : 0;

    const products = productsOf(orders);
    const topCommission = products.reduce<AffiliatedReportProduct | null>(
      (best, product) => (product.commission_value > (best?.commission_value ?? 0) ? product : best),
      null,
    );

    const byCoupon = new Map<string | null, { count: number; net: number; commission: number }>();
    for (const order of orders) {
      const totals = byCoupon.get(order.row.coupon_code) ?? { count: 0, net: 0, commission: 0 };
      totals.count += 1;
      totals.net += order.net;
      totals.commission += order.commission;
      byCoupon.set(order.row.coupon_code, totals);
    }

    return {
      summary: {
        orders_count: orders.length,
        gross_total: gross / 100,
        discount_total: (gross - net) / 100,
        net_total: net / 100,
        total_commission: sum(orders, "commission") / 100,
        commission_pct: commissionPct,
      },
      coupons: links
        .filter((link) => codeById.has(link.coupon_id))
        .map((link) => ({ code: codeById.get(link.coupon_id)!, commission_rate: Number(link.commission_rate) }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      orders: orders.map((order) => {
        let commissionRate = null;
        if (order.row.commission_rate !== null) commissionRate = Number(order.row.commission_rate);
        return {
          order_id: order.row.order_id,
          order_date: order.row.order_date,
          order_number: order.row.order_number,
          coupon_code: order.row.coupon_code,
          gross_total: order.gross / 100,
          discount_value: (order.gross - order.net) / 100,
          net_total: order.net / 100,
          commission_rate: commissionRate,
          commission: order.commission / 100,
          invoiced: order.row.invoiced,
          products: order.row.items.map((item) => ({ name: item.name, quantity: Number(item.quantity ?? 0) })),
        };
      }),
      evolution: {
        daily: evolutionBy(orders, (date) => date),
        weekly: evolutionBy(orders, weekStart),
        monthly: evolutionBy(orders, (date) => `${date.slice(0, 7)}-01`),
      },
      products,
      ranking: {
        most_sold_product: rankingProduct(products[0]),
        highest_commission_product: rankingProduct(topCommission),
      },
      by_coupon: [...byCoupon.entries()]
        .map(([code, totals]) => ({
          code,
          orders_count: totals.count,
          net_total: totals.net / 100,
          commission: totals.commission / 100,
        }))
        .sort((a, b) => b.net_total - a.net_total),
    };
  }
}

export default new AffiliatedReportService();
