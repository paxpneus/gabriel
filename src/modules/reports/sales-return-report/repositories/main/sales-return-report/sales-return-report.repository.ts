import { Op, QueryTypes } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import StockMovement from "../../../../../inventory/stock/stock-movements/stock-movements.model";
import {
  customerReturnMovementsWhere,
  unitBusinessPeriodWhere,
} from "../../../../../../shared/query/query-objects/stock-movements/stock-movement.filters";
import { SalesReturnLineRow } from "../../../models/sales-return-report.types";
import {
  proratedSaleItemColumnsSql,
  returnFactorSql,
} from "../../query-objects/sales-return-report.attributes";

export class SalesReturnReportRepository {
  /** Mesmos filtros das devoluções do product-stock-flow (unidade, ativo, período, CUSTOMER_RETURN): totais batem com ele. */
  async findReturnMovementIds(
    unitBusinessId: string,
    start: Date,
    end: Date,
  ): Promise<string[]> {
    const movements = await StockMovement.findAll({
      where: {
        [Op.and]: [
          unitBusinessPeriodWhere(unitBusinessId, start, end),
          customerReturnMovementsWhere(),
        ],
      },
      attributes: ["id"],
      raw: true,
    });
    return movements.map((movement) => movement.id);
  }

  /**
   * Uma linha por movimento de devolução, com qtd/preço do lançamento Bling. Nota = invoice_id ou id Bling (bling_origin_id);
   * venda = saída do mesmo emitente com o nº do return_invoice_reference; item vendido casa por produto, kit ou pedido de 1 item.
   */
  async findReturnLines(movementIds: string[]): Promise<SalesReturnLineRow[]> {
    if (!movementIds.length) return [];

    return sequelize.query<SalesReturnLineRow>(
      `
      WITH mv AS (
        SELECT
          m.id, m.product_id, m.movement_date, m.invoice_number,
          m.movement_quantity AS quantity,
          m.unit_price_invoice,
          COALESCE(
            m.invoice_id,
            (SELECT i.id FROM invoices i WHERE i.id_system = m.bling_origin_id LIMIT 1)
          ) AS return_invoice_id
        FROM stock_movements m
        WHERE m.id IN (:movementIds)
      ),
      -- Join único (number_system não tem índice; LATERAL por linha varria invoices a cada movimento).
      sale AS (
        SELECT DISTINCT ON (ret.id) ret.id AS return_invoice_id, s.id, s.number_system
        FROM invoices ret
        JOIN invoices s
          ON s.number_system = ret.return_invoice_reference
         AND s.sender_cnpj = ret.sender_cnpj
         AND s.id <> ret.id
        WHERE ret.id IN (SELECT return_invoice_id FROM mv)
          AND EXISTS (
            SELECT 1 FROM invoice_unit_business_attributes sa
            WHERE sa.invoice_id = s.id AND sa.type = 'OUTGOING'
          )
        ORDER BY ret.id, s.emitted_at DESC
      )
      SELECT
        mv.id                                                          AS movement_id,
        mv.return_invoice_id,
        COALESCE(ret.number_system, mv.invoice_number)                 AS return_invoice_number,
        TO_CHAR(mv.movement_date AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS return_date,
        fi.sku,
        fi.description,
        mv.quantity,
        COALESCE(mv.unit_price_invoice * mv.quantity, 0)               AS total_value,
        mv.unit_price_invoice IS NOT NULL                              AS has_price,
        p.name                                                         AS product_name,
        b.name                                                         AS brand_name,
        sale.number_system                                             AS sale_invoice_number,
        sos.order_id,
        sos.order_number_system,
        TO_CHAR(sos.order_date, 'YYYY-MM-DD')                          AS order_date,
        ub.name                                                        AS store_name,
        seller.name                                                    AS seller_name,
        COALESCE(customer.name, ret.customer_name)                     AS customer_name,
        soi.id IS NOT NULL                                             AS has_sale_item,
        ${proratedSaleItemColumnsSql("soi")}
      FROM mv
      LEFT JOIN invoices ret ON ret.id = mv.return_invoice_id
      LEFT JOIN invoice_fiscal_items fi ON fi.invoice_id = mv.return_invoice_id AND fi.product_id = mv.product_id
      LEFT JOIN products p ON p.id = mv.product_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN sale ON sale.return_invoice_id = mv.return_invoice_id
      LEFT JOIN LATERAL (
        SELECT o.id, o.order_id, o.order_number_system, o.order_date,
               o.unit_business_id, o.seller_id, o.customer_id
        FROM sales_order_snapshots o
        WHERE o.invoice_id = sale.id
        ORDER BY o.order_date DESC
        LIMIT 1
      ) sos ON TRUE
      LEFT JOIN unit_businesses ub ON ub.id = sos.unit_business_id
      LEFT JOIN contacts seller ON seller.id = sos.seller_id
      LEFT JOIN customers customer ON customer.id = sos.customer_id
      LEFT JOIN LATERAL (
        SELECT m.id, m.net_value, m.total_cost_snapshot, m.contribution_value, m.discount_value,
               m.tax_commission_allocated, m.freight_cost_allocated, m.computed_icms_value_allocated,
               m.commission_value, m.supplier_discount_value,
               ${returnFactorSql("mv", "m")} AS factor
        FROM sales_order_item_snapshots m
        WHERE m.order_snapshot_id = sos.id
          AND (
            m.product_id = mv.product_id
            OR EXISTS (
              SELECT 1 FROM kit_components kc
              WHERE kc.product_kit_id = m.product_id AND kc.product_component_id = mv.product_id
            )
            OR NOT EXISTS (
              SELECT 1 FROM sales_order_item_snapshots other
              WHERE other.order_snapshot_id = sos.id AND other.id <> m.id
            )
          )
        ORDER BY (m.product_id = mv.product_id) DESC NULLS LAST, m.id
        LIMIT 1
      ) soi ON TRUE
      ORDER BY mv.movement_date, return_invoice_number, mv.id
      `,
      { type: QueryTypes.SELECT, replacements: { movementIds } },
    );
  }
}

export default new SalesReturnReportRepository();
