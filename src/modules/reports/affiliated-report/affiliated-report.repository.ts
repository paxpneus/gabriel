import { QueryTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { AffiliatedReportFilters, AffiliatedReportOrderRow } from "./affiliated-report.types";

export class AffiliatedReportRepository {
  /**
   * Pedidos do afiliado no período, na mesma base do report_rows do seller report (snapshot por item, venda válida, sem "Vendedor 0").
   * Só valor, produtos e comissão do afiliado (já 0 em pedido não faturado); nada de cliente, custo ou lucro sai daqui.
   */
  findOrders(filters: AffiliatedReportFilters): Promise<AffiliatedReportOrderRow[]> {
    return sequelize.query<AffiliatedReportOrderRow>(
      `
      SELECT
        s.order_id,
        TO_CHAR(s.order_date, 'YYYY-MM-DD')   AS order_date,
        o.number_order_channel                AS order_number,
        SUM(s.net_total)                      AS total_sold,
        SUM(s.affiliated_commission_value)    AS commission,
        JSON_AGG(
          JSON_BUILD_OBJECT('name', COALESCE(p.name, s.product_name, oi.name), 'quantity', s.quantity)
          ORDER BY s.order_item_id
        )                                     AS products
      FROM seller_sales_order_item_snapshots s
      JOIN orders o ON o.id = s.order_id
      LEFT JOIN contacts sc ON sc.id = s.seller_id
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN order_items oi ON oi.id = s.order_item_id
      WHERE s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
        AND s.is_valid_sale = TRUE
        AND COALESCE(sc.name, '') <> 'Vendedor 0'
        AND s.affiliated_id = :affiliatedId
      GROUP BY s.order_id, s.order_date, o.number_order_channel
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
