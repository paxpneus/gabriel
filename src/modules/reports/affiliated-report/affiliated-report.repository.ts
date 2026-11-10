import { QueryTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { orderInvoicedSql } from "../../sales/orders/order/helpers/invoiced";
import { AffiliatedReportFilters, AffiliatedReportOrderRow } from "./affiliated-report.types";

export class AffiliatedReportRepository {
  /**
   * Pedidos do afiliado no período, na mesma base do report_rows do seller report (snapshot por item, venda válida, sem "Vendedor 0").
   * Só líquido = commission_base (base da comissão, já com o desconto do pedido); bruto e desconto não saem do SQL. Nada de cliente, custo ou lucro.
   */
  findOrders(filters: AffiliatedReportFilters): Promise<AffiliatedReportOrderRow[]> {
    return sequelize.query<AffiliatedReportOrderRow>(
      `
      SELECT
        s.order_id,
        TO_CHAR(s.order_date, 'YYYY-MM-DD')   AS order_date,
        o.number_order_channel                AS order_number,
        SUM(s.commission_base)                AS net_total,
        SUM(s.affiliated_commission_value)    AS commission,
        oc.commission_rate,
        cp.code                               AS coupon_code,
        ${orderInvoicedSql("o")}              AS invoiced,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'product_id', s.product_id,
            'name', COALESCE(p.name, s.product_name, oi.name),
            'brand', s.product_brand,
            'measure', s.product_measure,
            'quantity', s.quantity,
            'net_total', s.commission_base,
            'commission', s.affiliated_commission_value
          )
          ORDER BY s.order_item_id
        )                                     AS items
      FROM seller_sales_order_item_snapshots s
      JOIN orders o ON o.id = s.order_id
      LEFT JOIN contacts sc ON sc.id = s.seller_id
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN order_items oi ON oi.id = s.order_item_id
      -- No máximo um cupom com afiliado por pedido (índice parcial): não duplica os itens.
      LEFT JOIN order_coupons oc ON oc.order_id = s.order_id AND oc.contact_coupon_id IS NOT NULL
      LEFT JOIN coupons cp ON cp.id = oc.coupon_id
      WHERE s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND s.is_valid_sale = TRUE
        AND COALESCE(sc.name, '') <> 'Vendedor 0'
        AND s.affiliated_id = :affiliatedId
      GROUP BY s.order_id, s.order_date, o.id, oc.order_id, oc.coupon_id, cp.id
      ORDER BY s.order_date DESC, o.number_order_channel DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          affiliatedId: filters.affiliatedId,
          startDate: filters.startDate,
          endDate: filters.endDate,
        },
      },
    );
  }
}

export default new AffiliatedReportRepository();
