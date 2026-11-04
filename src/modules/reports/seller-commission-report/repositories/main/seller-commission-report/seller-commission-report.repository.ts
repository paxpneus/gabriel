import { QueryTypes } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import { SELLER_MANAGER_CONTACT_TYPE } from "../../../../../sales/contacts/contacts.types";
import { BLING_STATUS_DEFAULTS } from "../../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import {
  orderFinalSituationSql,
  orderInvoicedSql,
} from "../../../../../sales/orders/order/helpers/invoiced";
import { invoiceCancelledSql } from "../../../../../warehouse/fiscal/invoices/invoice/helpers/custom-filters";
import {
  SellerCommissionItemRow,
  SellerCommissionReportWarnings,
} from "../../../models/seller-commission-report.types";

// Situações não canceladas no Bling (Em aberto + finais): pedido sem custo nelas é aviso; cancelado não.
const ACTIVE_ORDER_SITUATIONS = BLING_STATUS_DEFAULTS.filter((status) => !status.is_cancelled).map(
  (status) => status.external_status_id,
);

/** Período (data do pedido) e filtros; lista ausente = sem restrição. `unitBusinessIds` = loja do pedido (e/ou dos gerentes). */
export interface CommissionFilters {
  startDate: string;
  endDate: string;
  productIds?: string[];
  sellerIds?: string[];
  unitBusinessIds?: string[];
  originUnitBusinessIds?: string[];
}

export class SellerCommissionReportRepository {
  /** Itens do seller report no período (mesma base dele) só de pedidos faturados, com vendedor, gerentes da loja, cliente e produto. */
  async findCommissionRows(filters: CommissionFilters): Promise<SellerCommissionItemRow[]> {
    const conditions = this.filterConditions(filters);
    if (!conditions) return [];

    return sequelize.query<SellerCommissionItemRow>(
      `
      SELECT
        s.order_item_id,
        s.order_id,
        TO_CHAR(s.order_date, 'YYYY-MM-DD')     AS order_date,
        o.number_order_system                   AS order_number,
        i.number_system                         AS invoice_number,
        ub.name                                 AS store_name,
        sc.name                                 AS seller_name,
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
      LEFT JOIN invoices i ON i.id = o.invoice_id
      LEFT JOIN contacts sc ON sc.id = s.seller_id
      LEFT JOIN order_items oi ON oi.id = s.order_item_id
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN unit_businesses ub ON ub.id = s.unit_business_id
      LEFT JOIN customers customer ON customer.id = s.customer_id
      -- Gerente = contato SELLER_MANAGER da loja da venda (contacts.unit_business_id).
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(manager.name, ', ' ORDER BY manager.name) AS names
        FROM contacts manager
        WHERE manager.type = :managerContactType
          AND manager.unit_business_id = s.unit_business_id
      ) managers ON TRUE
      WHERE s.is_valid_sale = TRUE
        AND ${orderInvoicedSql("o")}
        ${conditions}
      ORDER BY s.order_date, o.number_order_system, s.order_item_id
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { ...filters, managerContactType: SELLER_MANAGER_CONTACT_TYPE },
      },
    );
  }

  /** Pedidos do seller report no período (mesmos filtros) que ficaram fora da comissão, contados por motivo. */
  async countOrderWarnings(filters: CommissionFilters): Promise<SellerCommissionReportWarnings> {
    const conditions = this.filterConditions(filters);
    if (!conditions) return { orders_open: 0, orders_final_without_invoice: 0, orders_missing_cost: 0 };

    const [warnings] = await sequelize.query<SellerCommissionReportWarnings>(
      `
      WITH ord AS (
        SELECT s.order_id,
               BOOL_AND(s.is_valid_sale) AS is_valid_sale,
               BOOL_AND(s.has_cost_data) AS has_cost_data
        FROM seller_sales_order_item_snapshots s
        JOIN orders o ON o.id = s.order_id
        LEFT JOIN invoices i ON i.id = o.invoice_id
        LEFT JOIN contacts sc ON sc.id = s.seller_id
        WHERE TRUE
          ${conditions}
        GROUP BY s.order_id
      )
      SELECT
        COUNT(*) FILTER (WHERE ord.is_valid_sale AND NOT ${orderFinalSituationSql("o")})::int AS orders_open,
        COUNT(*) FILTER (
          WHERE ord.is_valid_sale AND ${orderFinalSituationSql("o")} AND NOT ${orderInvoicedSql("o")}
        )::int AS orders_final_without_invoice,
        -- Cancelado (situação ou nota) fica de fora: não é venda, faltando custo ou não.
        COUNT(*) FILTER (
          WHERE NOT ord.has_cost_data
            AND o.actual_situation IN (:activeSituations)
            AND NOT ${invoiceCancelledSql("o.invoice_id")}
        )::int AS orders_missing_cost
      FROM ord
      JOIN orders o ON o.id = ord.order_id
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { ...filters, activeSituations: ACTIVE_ORDER_SITUATIONS },
      },
    );
    return warnings;
  }

  /**
   * WHERE comum (aliases s = item do seller report, o = pedido, i = nota, sc = vendedor), igual ao report_rows do seller report;
   * null quando algum filtro veio vazio (ex.: marca sem produto, gerente sem loja) e não casa nada.
   */
  private filterConditions(filters: CommissionFilters): string | null {
    const { productIds, sellerIds, unitBusinessIds, originUnitBusinessIds } = filters;
    if ([productIds, sellerIds, unitBusinessIds, originUnitBusinessIds].some((ids) => ids && !ids.length)) {
      return null;
    }

    const conditions = [
      "AND s.order_date BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)",
      "AND COALESCE(sc.name, '') <> 'Vendedor 0'",
    ];
    // Item kit casa pelo componente também (marca/produto do pneu dentro do kit).
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
    if (originUnitBusinessIds) conditions.push("AND i.origin_unit_business_id IN (:originUnitBusinessIds)");
    return conditions.join("\n        ");
  }
}

export default new SellerCommissionReportRepository();
