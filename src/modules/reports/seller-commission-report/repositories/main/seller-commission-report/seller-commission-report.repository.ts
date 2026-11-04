import { Op, QueryTypes, WhereOptions } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import StockMovement from "../../../../../inventory/stock/stock-movements/stock-movements.model";
import {
  movementInvoiceIdsSql,
  outputMovementsWhere,
  unitBusinessPeriodWhere,
} from "../../../../../../shared/query/query-objects/stock-movements/stock-movement.filters";
import { SELLER_MANAGER_CONTACT_TYPE } from "../../../../../sales/contacts/contacts.types";
import { invoiceCancelledSql } from "../../../../../warehouse/fiscal/invoices/invoice/helpers/custom-filters";
import { InvoiceUnitBusinessAttributesStatus } from "../../../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import {
  CommissionInvoiceRow,
  InvoiceWithoutMovementRow,
  SellerCommissionItemRow,
} from "../../../models/seller-commission-report.types";

// Nota de saída que deveria ter movimento: só não canceladas (cancelada sem movimento é ignorada).
const ACTIVE_SALE_INVOICE_STATUSES: InvoiceUnitBusinessAttributesStatus[] = ["OPEN", "PENDING", "FINISHED"];

/** Filtros das linhas; ausente = sem restrição. `unitBusinessIds` = lojas dos gerentes filtrados. */
export interface CommissionRowFilters {
  productIds?: string[];
  sellerIds?: string[];
  unitBusinessIds?: string[];
}

export class SellerCommissionReportRepository {
  /** Mesmas saídas do product-stock-flow (SALE_OUT + ajuste OUT do CSV com nº do pedido); `productIds` só restringe quando vier. */
  async findSaleMovementIds(
    unitBusinessId: string,
    start: Date,
    end: Date,
    productIds?: string[],
  ): Promise<string[]> {
    const conditions: WhereOptions[] = [
      unitBusinessPeriodWhere(unitBusinessId, start, end),
      outputMovementsWhere(),
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
   * Uma linha por nota dos movimentos (nota = invoice_id ou id Bling; ajuste do CSV vai direto no pedido pelo nº),
   * com o pedido (orders.invoice_id) e como ele está no seller report.
   */
  async findMovementInvoices(movementIds: string[]): Promise<CommissionInvoiceRow[]> {
    if (!movementIds.length) return [];

    return sequelize.query<CommissionInvoiceRow>(
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
        SELECT inv.invoice_key, o.id, o.number_order_system, o.seller_id, o.unit_business_id,
               COALESCE(o.date, o.created_at) AS order_at
        FROM inv JOIN orders o ON o.invoice_id = inv.invoice_id
        UNION ALL
        SELECT inv.invoice_key, o.id, o.number_order_system, o.seller_id, o.unit_business_id,
               COALESCE(o.date, o.created_at) AS order_at
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
      ),
      -- Situação do pedido no seller report, agregada uma vez (em vez de LATERAL por nota).
      snap AS (
        SELECT s.order_id,
               COUNT(*)::integer          AS items_count,
               BOOL_AND(s.has_cost_data)  AS has_cost_data,
               BOOL_AND(s.is_valid_sale)  AS is_valid_sale
        FROM seller_sales_order_item_snapshots s
        JOIN ord ON ord.id = s.order_id
        GROUP BY s.order_id
      )
      SELECT
        inv.invoice_key,
        inv.invoice_id,
        COALESCE(i.number_system, inv.movement_invoice_number)                    AS invoice_number,
        inv.is_order_adjustment,
        TO_CHAR(inv.movement_date AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS movement_date,
        ${invoiceCancelledSql("inv.invoice_id")}                                  AS invoice_cancelled,
        returned.invoice_id IS NOT NULL                                           AS has_return_invoice,
        COALESCE(returned.has_return_movement, FALSE)                             AS has_return,
        returned.return_invoice_number,
        ord.id                                                                    AS order_id,
        ord.number_order_system                                                   AS order_number,
        ord.seller_id,
        ord.unit_business_id,
        -- Mesmo corte do order_source do seller report (loja 0 com vendedor entra).
        (ord.seller_id IS NOT NULL AND COALESCE(sc.name, '') <> 'Vendedor 0')    AS has_seller,
        COALESCE(snap.items_count, 0)                                             AS snapshot_items,
        snap.has_cost_data,
        snap.is_valid_sale
      FROM inv
      LEFT JOIN invoices i ON i.id = inv.invoice_id
      LEFT JOIN ord ON ord.invoice_key = inv.invoice_key
      LEFT JOIN returned ON returned.invoice_id = inv.invoice_id
      LEFT JOIN contacts sc ON sc.id = ord.seller_id
      LEFT JOIN snap ON snap.order_id = ord.id
      ORDER BY inv.movement_date, invoice_number
      `,
      { type: QueryTypes.SELECT, replacements: { movementIds: movementIds.join(",") } },
    );
  }

  /** Itens válidos do seller report dos pedidos que entraram, com vendedor, gerentes da loja, cliente e produto. */
  async findCommissionRows(
    orderIds: string[],
    filters: CommissionRowFilters,
  ): Promise<SellerCommissionItemRow[]> {
    const { productIds, sellerIds, unitBusinessIds } = filters;
    // Filtro vindo vazio (ex.: marca sem produto, gerente sem loja) não casa nada.
    if (!orderIds.length || [productIds, sellerIds, unitBusinessIds].some((ids) => ids && !ids.length)) {
      return [];
    }

    const conditions: string[] = [];
    // Item kit casa pelo componente (o movimento do Bling é do componente).
    if (productIds) {
      conditions.push(`AND (
        s.product_id IN (:productIds)
        OR EXISTS (
          SELECT 1 FROM kit_components kc
          WHERE kc.product_kit_id = s.product_id AND kc.product_component_id IN (:productIds)
        )
      )`);
    }
    if (sellerIds) conditions.push("AND s.seller_id IN (:sellerIds)");
    if (unitBusinessIds) conditions.push("AND s.unit_business_id IN (:unitBusinessIds)");

    return sequelize.query<SellerCommissionItemRow>(
      `
      SELECT
        s.order_item_id,
        s.order_id,
        TO_CHAR(s.order_date, 'YYYY-MM-DD')     AS order_date,
        o.number_order_system                   AS order_number,
        ub.name                                 AS store_name,
        seller.name                             AS seller_name,
        managers.names                          AS manager_names,
        customer.name                           AS customer_name,
        COALESCE(p.brand, s.product_brand)      AS brand,
        COALESCE(p.name, s.product_name, oi.name) AS product_name,
        oi.sku,
        s.quantity,
        s.net_total,
        s.commission_base,
        s.commission_rate,
        s.commission_value,
        s.manager_commission_rate,
        s.manager_commission_value
      FROM seller_sales_order_item_snapshots s
      JOIN orders o ON o.id = s.order_id
      LEFT JOIN order_items oi ON oi.id = s.order_item_id
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN unit_businesses ub ON ub.id = s.unit_business_id
      LEFT JOIN contacts seller ON seller.id = s.seller_id
      LEFT JOIN customers customer ON customer.id = s.customer_id
      -- Gerente = contato SELLER_MANAGER da loja da venda (contacts.unit_business_id).
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(manager.name, ', ' ORDER BY manager.name) AS names
        FROM contacts manager
        WHERE manager.type = :managerContactType
          AND manager.unit_business_id = s.unit_business_id
      ) managers ON TRUE
      WHERE s.order_id IN (:orderIds)
        AND s.is_valid_sale = TRUE
        ${conditions.join("\n        ")}
      ORDER BY s.order_date, o.number_order_system, s.order_item_id
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { orderIds, productIds, sellerIds, unitBusinessIds, managerContactType: SELLER_MANAGER_CONTACT_TYPE },
      },
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
    productIds?: string[],
  ): Promise<InvoiceWithoutMovementRow[]> {
    if (productIds && !productIds.length) return [];

    let productFilter = "";
    if (productIds) {
      productFilter = `AND EXISTS (
          SELECT 1 FROM invoice_fiscal_items f
          WHERE f.invoice_id = i.id AND f.product_id IN (:productIds)
        )`;
    }

    return sequelize.query<InvoiceWithoutMovementRow>(
      `
      WITH candidates AS (
        SELECT i.id, i.number_system, i.emitted_at
        FROM invoices i
        JOIN unit_businesses ub ON ub.id = :unitBusinessId AND ub.cnpj = i.sender_cnpj
        JOIN invoice_unit_business_attributes a
          ON a.invoice_id = i.id AND a.unit_business_id = ub.id
         AND a.type = 'OUTGOING' AND a.status IN (:statuses)
        WHERE i.emitted_at BETWEEN :start AND :end
          ${productFilter}
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
        SELECT DISTINCT ON (o.invoice_id)
          o.invoice_id, o.id, o.number_order_system, o.seller_id, o.unit_business_id
        FROM orders o
        JOIN candidates c ON c.id = o.invoice_id
        ORDER BY o.invoice_id, COALESCE(o.date, o.created_at) DESC
      )
      SELECT
        c.number_system                                                         AS invoice_number,
        TO_CHAR(c.emitted_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')    AS emitted_date,
        co.id                                                                   AS order_id,
        co.number_order_system                                                  AS order_number,
        co.seller_id,
        co.unit_business_id,
        (co.seller_id IS NOT NULL AND COALESCE(sc.name, '') <> 'Vendedor 0')    AS has_seller
      FROM candidates c
      LEFT JOIN candidate_order co ON co.invoice_id = c.id
      LEFT JOIN contacts sc ON sc.id = co.seller_id
      WHERE NOT EXISTS (SELECT 1 FROM moved WHERE moved.invoice_id = c.id)
      ORDER BY c.emitted_at, c.number_system
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { unitBusinessId, start, end, statuses: ACTIVE_SALE_INVOICE_STATUSES, productIds },
      },
    );
  }
}

export default new SellerCommissionReportRepository();
