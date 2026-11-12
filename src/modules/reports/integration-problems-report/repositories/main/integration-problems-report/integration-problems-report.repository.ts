import { Op, QueryTypes } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import StockMovement from "../../../../../inventory/stock/stock-movements/stock-movements.model";
import {
  movementInvoiceIdsSql,
  outputMovementsWhere,
  unitBusinessPeriodWhere,
} from "../../../../../../shared/query/query-objects/stock-movements/stock-movement.filters";
import { invoiceCancelledSql, notInternalInvoiceSql } from "../../../../../warehouse/fiscal/invoices/invoice";
import invoiceOperationRepository from "../../../../../warehouse/fiscal/invoices/invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../../../warehouse/fiscal/invoices/invoice-operation/invoice-operation.types";
import { InvoiceUnitBusinessAttributesStatus } from "../../../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import {
  SaleInvoiceWithoutMovementRow,
  SaleMovementInvoiceRow,
} from "../../../models/integration-problems-report.types";

// Nota de saída que deveria ter movimento: só não canceladas (cancelada sem movimento é ignorada).
const ACTIVE_SALE_INVOICE_STATUSES: InvoiceUnitBusinessAttributesStatus[] = ["OPEN", "PENDING", "FINISHED"];

export class IntegrationProblemsReportRepository {
  /** Mesmas saídas do product-stock-flow (SALE_OUT + ajuste OUT do CSV com nº do pedido). */
  async findSaleMovementIds(unitBusinessId: string, start: Date, end: Date): Promise<string[]> {
    const movements = await StockMovement.findAll({
      where: { [Op.and]: [unitBusinessPeriodWhere(unitBusinessId, start, end), outputMovementsWhere()] },
      attributes: ["id"],
      raw: true,
    });
    return movements.map((movement) => movement.id);
  }

  /**
   * Uma linha por nota dos movimentos (nota = invoice_id ou id Bling; ajuste do CSV vai direto no pedido pelo nº),
   * com o pedido (orders.invoice_id) e a devolução da nota cancelada.
   */
  async findMovementInvoices(movementIds: string[]): Promise<SaleMovementInvoiceRow[]> {
    if (!movementIds.length) return [];

    return sequelize.query<SaleMovementInvoiceRow>(
      `
      WITH mv AS (
        SELECT
          m.id, m.movement_type, m.movement_date, m.invoice_number,
          CASE WHEN m.movement_type = 'MANUAL_ADJUSTMENT' THEN NULL
               ELSE COALESCE(m.invoice_id, bling_invoice.id)
          END AS invoice_id
        FROM stock_movements m
        -- Ids num literal só (milhares de literais no IN pesam no parse).
        JOIN UNNEST(string_to_array(:movementIds, ',')::uuid[]) AS selected(id) ON selected.id = m.id
        -- Join em vez de subconsulta por linha: a estimativa alta disparava ~4s de compilação JIT. id_system é único.
        LEFT JOIN invoices bling_invoice ON bling_invoice.id_system = m.bling_origin_id
      ),
      -- Sem nota achada agrupa pelo nº do movimento (no ajuste do CSV é o nº do pedido).
      inv AS (
        SELECT
          COALESCE(mv.invoice_id::text, mv.movement_type || ':' || COALESCE(mv.invoice_number, mv.id::text)) AS invoice_key,
          mv.invoice_id,
          BOOL_OR(mv.movement_type = 'MANUAL_ADJUSTMENT') AS is_order_adjustment,
          MAX(mv.invoice_number) AS movement_invoice_number,
          MIN(mv.movement_date) AS movement_date
        FROM mv
        GROUP BY 1, 2
      ),
      -- orders.invoice_id sem índice: join único (UNION em vez de OR, que viraria loop por nota).
      ord_all AS (
        SELECT inv.invoice_key, o.id, o.number_order_system, COALESCE(o.date, o.created_at) AS order_at
        FROM inv JOIN orders o ON o.invoice_id = inv.invoice_id
        UNION ALL
        SELECT inv.invoice_key, o.id, o.number_order_system, COALESCE(o.date, o.created_at) AS order_at
        FROM inv JOIN orders o ON o.number_order_system = inv.movement_invoice_number
        WHERE inv.is_order_adjustment
      ),
      ord AS (
        SELECT DISTINCT ON (invoice_key) *
        FROM ord_all
        ORDER BY invoice_key, order_at DESC
      ),
      return_moved AS (${movementInvoiceIdsSql("m.is_active AND m.movement_type = 'CUSTOMER_RETURN'")}),
      -- Devolução da nota cancelada: NF do mesmo emitente com o nº dela no return_invoice_reference; movimentada = CUSTOMER_RETURN ativo.
      returned AS (
        SELECT
          s.id AS invoice_id,
          BOOL_OR(rm.invoice_id IS NOT NULL) AS has_return_movement,
          MIN(ret.number_system) AS return_invoice_number
        FROM inv
        JOIN invoices s ON s.id = inv.invoice_id
        JOIN invoices ret
          ON ret.return_invoice_reference = s.number_system
         AND ret.sender_cnpj = s.sender_cnpj
         AND ret.id <> s.id
        LEFT JOIN return_moved rm ON rm.invoice_id = ret.id
        WHERE ${invoiceCancelledSql("s.id")}
        GROUP BY s.id
      )
      SELECT
        inv.invoice_id,
        COALESCE(i.number_system, inv.movement_invoice_number)                    AS invoice_number,
        inv.is_order_adjustment,
        TO_CHAR(inv.movement_date AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS movement_date,
        ${invoiceCancelledSql("inv.invoice_id")}                                  AS invoice_cancelled,
        returned.invoice_id IS NOT NULL                                           AS has_return_invoice,
        COALESCE(returned.has_return_movement, FALSE)                             AS has_return,
        returned.return_invoice_number,
        ord.id                                                                    AS order_id,
        ord.number_order_system                                                   AS order_number
      FROM inv
      LEFT JOIN invoices i ON i.id = inv.invoice_id
      LEFT JOIN ord ON ord.invoice_key = inv.invoice_key
      LEFT JOIN returned ON returned.invoice_id = inv.invoice_id
      ORDER BY inv.movement_date, invoice_number
      `,
      { type: QueryTypes.SELECT, replacements: { movementIds: movementIds.join(",") } },
    );
  }

  /**
   * Saídas emitidas pela unidade no período, não canceladas, sem movimento de venda ativo (qualquer data).
   * Venda do CSV do Bling conta como movimentada pelo ajuste de saída com o nº do pedido da nota.
   */
  async findInvoicesWithoutMovement(
    unitBusinessId: string,
    start: Date,
    end: Date,
  ): Promise<SaleInvoiceWithoutMovementRow[]> {
    const internalOperationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    return sequelize.query<SaleInvoiceWithoutMovementRow>(
      `
      WITH candidates AS (
        SELECT i.id, i.number_system, i.emitted_at
        FROM invoices i
        JOIN unit_businesses ub ON ub.id = :unitBusinessId AND ub.cnpj = i.sender_cnpj
        JOIN invoice_unit_business_attributes a
          ON a.invoice_id = i.id AND a.unit_business_id = ub.id
         AND a.type = 'OUTGOING' AND a.status IN (:statuses)
        WHERE i.emitted_at BETWEEN :start AND :end
          -- Nota interna não é venda (só aparece nos fluxos de internal/).
          AND ${notInternalInvoiceSql(internalOperationId, "i.invoice_operation_id")}
      ),
      moved AS (
        ${movementInvoiceIdsSql("m.unit_business_id = :unitBusinessId AND m.is_active AND m.movement_type = 'SALE_OUT'")}
        UNION
        SELECT o.invoice_id FROM stock_movements m
        JOIN orders o ON o.number_order_system = m.invoice_number
        WHERE m.unit_business_id = :unitBusinessId AND m.is_active
          AND m.movement_type = 'MANUAL_ADJUSTMENT' AND m.direction = 'OUT'
          AND o.invoice_id IS NOT NULL
      ),
      -- Um pedido por nota; orders.invoice_id sem índice: join único em vez de LATERAL por nota.
      candidate_order AS (
        SELECT DISTINCT ON (o.invoice_id) o.invoice_id, o.number_order_system
        FROM orders o
        JOIN candidates c ON c.id = o.invoice_id
        ORDER BY o.invoice_id, COALESCE(o.date, o.created_at) DESC
      )
      SELECT
        c.number_system                                                         AS invoice_number,
        TO_CHAR(c.emitted_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')    AS emitted_date,
        co.number_order_system                                                  AS order_number
      FROM candidates c
      LEFT JOIN candidate_order co ON co.invoice_id = c.id
      WHERE NOT EXISTS (SELECT 1 FROM moved WHERE moved.invoice_id = c.id)
      ORDER BY c.emitted_at, c.number_system
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { unitBusinessId, start, end, statuses: ACTIVE_SALE_INVOICE_STATUSES },
      },
    );
  }
}

export default new IntegrationProblemsReportRepository();
