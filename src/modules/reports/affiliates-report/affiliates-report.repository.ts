import { QueryTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { orderInvoicedSql } from "../../sales/orders/order/helpers/invoiced";
import { AFFILIATED_CONTACT_TYPE } from "../../sales/contacts/contacts.types";
import { AffiliatesReportParams, AffiliatesReportRow } from "./affiliates-report.types";

export class AffiliatesReportRepository {
  /**
   * Um afiliado por linha (todos os contatos AFFILIATED, zerados sem venda), com as vendas válidas do período nos snapshots do sales report.
   * Lucro = contribution_value; comissão = affiliated_commission_value (0 em pedido não faturado).
   */
  findAffiliateTotals(params: AffiliatesReportParams): Promise<AffiliatesReportRow[]> {
    const affiliatedIds = params.affiliatedIds?.length ? params.affiliatedIds : null;

    return sequelize.query<AffiliatesReportRow>(
      `
      WITH sales AS (
        SELECT
          sos.affiliated_id,
          COUNT(DISTINCT sois.order_id)::integer AS sales_count,
          COALESCE(SUM(sois.quantity), 0) AS items_sold_count,
          COALESCE(SUM(sois.net_total), 0) AS total_sold,
          COALESCE(SUM(sois.contribution_value), 0) AS profit,
          COALESCE(SUM(sois.affiliated_commission_value), 0) AS affiliated_comission,
          COUNT(DISTINCT sois.order_id) FILTER (WHERE NOT ${orderInvoicedSql("o")})::integer AS orders_not_invoiced,
          ARRAY_AGG(DISTINCT sois.order_id) AS order_ids
        FROM sales_order_item_snapshots sois
        JOIN sales_order_snapshots sos ON sos.id = sois.order_snapshot_id
        JOIN orders o ON o.id = sois.order_id
        WHERE sos.affiliated_id IS NOT NULL
          AND sos.snapshot_status = 'completed'
          AND sois.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
          ${affiliatedIds ? "AND sos.affiliated_id IN (:affiliatedIds)" : ""}
        GROUP BY sos.affiliated_id
      )
      SELECT
        ct.id AS affiliated_id,
        ct.name AS affiliated_name,
        -- Cupons com dono usados nas vendas do período.
        (
          SELECT STRING_AGG(DISTINCT cp.code, ', ')
          FROM order_coupons oc
          JOIN coupons cp ON cp.id = oc.coupon_id
          WHERE oc.order_id = ANY(s.order_ids)
            AND oc.contact_coupon_id IS NOT NULL
        ) AS coupon_codes,
        COALESCE(s.sales_count, 0) AS sales_count,
        COALESCE(s.items_sold_count, 0) AS items_sold_count,
        COALESCE(s.total_sold, 0) AS total_sold,
        COALESCE(s.profit, 0) AS profit,
        COALESCE(s.affiliated_comission, 0) AS affiliated_comission,
        COALESCE(s.orders_not_invoiced, 0) AS orders_not_invoiced
      FROM contacts ct
      LEFT JOIN sales s ON s.affiliated_id = ct.id
      -- Afiliado da venda é sempre contato AFFILIATED (vínculo validado); o OR só garante que nenhuma venda some.
      WHERE (ct.type = :affiliatedType OR s.affiliated_id IS NOT NULL)
        ${affiliatedIds ? "AND ct.id IN (:affiliatedIds)" : ""}
      ORDER BY COALESCE(s.total_sold, 0) DESC, ct.name
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          startDate: params.startDate,
          endDate: params.endDate,
          affiliatedIds,
          affiliatedType: AFFILIATED_CONTACT_TYPE,
        },
      },
    );
  }
}

export default new AffiliatesReportRepository();
