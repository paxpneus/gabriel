import { Op } from "sequelize";
import { contactService } from "../../sales/contacts";
import { AFFILIATED_CONTACT_TYPE } from "../../sales/contacts/contacts.types";
import contactCouponService from "../../sales/coupons/contact-coupons/contact-coupons.service";
import couponService from "../../sales/coupons/coupons/coupons.service";
import affiliatedReportRepository, { AffiliatedReportRepository } from "./affiliated-report.repository";
import { AffiliatedReport } from "./affiliated-report.types";

// Valores em centavos inteiros: soma do total sem resíduo de ponto flutuante.
const toCents = (value: string | number | null | undefined): number => Math.round(Number(value ?? 0) * 100);

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

    const orders = orderRows.map((row) => ({
      order_id: row.order_id,
      order_date: row.order_date,
      order_number: row.order_number,
      total_sold: toCents(row.total_sold) / 100,
      commission: toCents(row.commission) / 100,
      products: row.products,
    }));

    return {
      summary: {
        total_commission: orderRows.reduce((sum, row) => sum + toCents(row.commission), 0) / 100,
      },
      coupons: links
        .filter((link) => codeById.has(link.coupon_id))
        .map((link) => ({ code: codeById.get(link.coupon_id)!, commission_rate: Number(link.commission_rate) }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      orders,
    };
  }
}

export default new AffiliatedReportService();
