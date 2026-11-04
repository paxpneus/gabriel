import { Op, QueryTypes, WhereOptions } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import StockMovement from "../../../../../inventory/stock/stock-movements/stock-movements.model";
import {
  customerReturnMovementsWhere,
  movementInvoiceIdsSql,
  unitBusinessPeriodWhere,
} from "../../../../../../shared/query/query-objects/stock-movements/stock-movement.filters";
import { XML_HEAD_LENGTH } from "../../../../../warehouse/fiscal/invoices/invoice/helpers/nfe-ide";
import { InvoiceUnitBusinessAttributesStatus } from "../../../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import {
  ReturnInvoiceCandidateRow,
  SalesReturnLineRow,
} from "../../../models/sales-return-report.types";

// Nota de devolução que deveria ter movimento: só não canceladas.
const ACTIVE_RETURN_INVOICE_STATUSES: InvoiceUnitBusinessAttributesStatus[] = ["OPEN", "PENDING", "FINISHED"];

export class SalesReturnReportRepository {
  /** Mesmos filtros das devoluções do product-stock-flow (unidade, ativo, período, CUSTOMER_RETURN); `productIds` só restringe quando vier. */
  async findReturnMovementIds(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds?: string[],
  ): Promise<string[]> {
    const conditions: WhereOptions[] = [
      unitBusinessPeriodWhere(unitBusinessId, start, end),
      customerReturnMovementsWhere(),
    ];
    if (productIds) conditions.push({ product_id: { [Op.in]: productIds } });

    const movements = await StockMovement.findAll({
      where: { [Op.and]: conditions },
      attributes: ["id"],
      raw: true,
    });
    return movements.map((movement) => movement.id);
  }

  /**
   * Uma linha por movimento de devolução, com qtd e valor do lançamento Bling (preço × qtd, igual ao stock flow).
   * Nota = invoice_id ou id Bling (bling_origin_id); venda = saída do mesmo emitente com o nº do return_invoice_reference.
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
        -- Ids num literal só: IN/ARRAY com milhares de literais levava segundos só pra montar.
        JOIN UNNEST(string_to_array(:movementIds, ',')::uuid[]) AS selected(id) ON selected.id = m.id
      ),
      -- Join único (number_system não tem índice; LATERAL por linha varria invoices a cada movimento).
      sale AS (
        SELECT DISTINCT ON (ret.id) ret.id AS return_invoice_id, s.id, s.number_system, s.store_id
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
        p.brand,
        sale.number_system                                             AS sale_invoice_number,
        sos.order_id,
        sos.order_number_system,
        TO_CHAR(sos.order_date, 'YYYY-MM-DD')                          AS order_date,
        ub.name                                                        AS store_name,
        seller.name                                                    AS seller_name,
        COALESCE(customer.name, ret.customer_name)                     AS customer_name,
        channel.name                                                   AS sales_channel
      FROM mv
      LEFT JOIN invoices ret ON ret.id = mv.return_invoice_id
      -- SKU/descrição do item da nota; nota com 1 item casa mesmo com produto diferente (mapeamento da nota ≠ do lançamento Bling).
      LEFT JOIN LATERAL (
        SELECT MIN(f.sku) AS sku, MIN(f.description) AS description
        FROM invoice_fiscal_items f
        WHERE f.invoice_id = mv.return_invoice_id
          AND (
            f.product_id = mv.product_id
            OR NOT EXISTS (
              SELECT 1 FROM invoice_fiscal_items other
              WHERE other.invoice_id = f.invoice_id AND other.id <> f.id
            )
          )
      ) fi ON TRUE
      LEFT JOIN products p ON p.id = mv.product_id
      LEFT JOIN sale ON sale.return_invoice_id = mv.return_invoice_id
      LEFT JOIN LATERAL (
        SELECT o.order_id, o.order_number_system, o.order_date,
               o.unit_business_id, o.seller_id, o.customer_id, o.store_id
        FROM sales_order_snapshots o
        WHERE o.invoice_id = sale.id
        ORDER BY o.order_date DESC
        LIMIT 1
      ) sos ON TRUE
      LEFT JOIN unit_businesses ub ON ub.id = sos.unit_business_id
      LEFT JOIN contacts seller ON seller.id = sos.seller_id
      LEFT JOIN customers customer ON customer.id = sos.customer_id
      -- Canal da venda: pedido > nota de venda > devolução (devolução vem "Outros" em venda de loja física).
      LEFT JOIN stores channel ON channel.id = COALESCE(sos.store_id, sale.store_id, ret.store_id)
      ORDER BY mv.movement_date, return_invoice_number, mv.id
      `,
      { type: QueryTypes.SELECT, replacements: { movementIds: movementIds.join(",") } },
    );
  }

  /**
   * Entradas emitidas pela própria unidade no período, não canceladas, sem movimento CUSTOMER_RETURN ativo (qualquer data).
   * Vem o início do XML: a service confirma finNFe = devolução (não fica em coluna).
   */
  async findReturnInvoiceCandidatesWithoutMovement(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds?: string[],
  ): Promise<ReturnInvoiceCandidateRow[]> {
    if (productIds && !productIds.length) return [];

    let productFilter = "";
    if (productIds) {
      productFilter = `AND EXISTS (
          SELECT 1 FROM invoice_fiscal_items f
          WHERE f.invoice_id = i.id AND f.product_id IN (:productIds)
        )`;
    }

    return sequelize.query<ReturnInvoiceCandidateRow>(
      `
      WITH moved AS (
        ${movementInvoiceIdsSql("m.unit_business_id = :unitBusinessId AND m.is_active AND m.movement_type = 'CUSTOMER_RETURN'")}
      )
      SELECT
        i.number_system                                                      AS invoice_number,
        TO_CHAR(i.emitted_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS emitted_date,
        LEFT(i.xml_path, ${XML_HEAD_LENGTH})                                 AS xml_head
      FROM invoices i
      JOIN unit_businesses ub ON ub.id = :unitBusinessId AND ub.cnpj = i.sender_cnpj
      JOIN invoice_unit_business_attributes a
        ON a.invoice_id = i.id AND a.unit_business_id = ub.id
       AND a.type = 'INCOMING' AND a.status IN (:statuses)
      WHERE i.emitted_at BETWEEN :start AND :end
        AND NOT EXISTS (SELECT 1 FROM moved WHERE moved.invoice_id = i.id)
        ${productFilter}
      ORDER BY i.emitted_at, i.number_system
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { unitBusinessId, start, end, statuses: ACTIVE_RETURN_INVOICE_STATUSES, productIds },
      },
    );
  }
}

export default new SalesReturnReportRepository();
