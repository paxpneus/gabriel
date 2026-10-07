import { Op, Sequelize, WhereOptions } from "sequelize";

/** order_date (DATEONLY) dentro de [dateFrom, dateTo], ambos YYYY-MM-DD. */
export function snapshotPeriodWhere(
  dateFrom: string,
  dateTo: string,
): WhereOptions {
  return { order_date: { [Op.between]: [dateFrom, dateTo] } };
}

/** Pedido válido no relatório: não cancelado e com custo completo. */
export function completedSnapshotWhere(): WhereOptions {
  return { snapshot_status: "completed" };
}

/**
 * Nenhum item do pedido sem custo, conferido na hora (mesma regra do general do sales report).
 * snapshotAlias = alias SQL de sales_order_snapshots na query (model ou include).
 */
export function completeCostSnapshotWhere(snapshotAlias: string): WhereOptions {
  return Sequelize.literal(`NOT EXISTS (
    SELECT 1
    FROM sales_order_item_snapshots cost_check
    WHERE cost_check.order_snapshot_id = "${snapshotAlias}"."id"
      AND COALESCE(cost_check.average_cost_snapshot, 0) <= 0
  )`) as unknown as WhereOptions;
}

export function snapshotIntegrationWhere(integrationId: string): WhereOptions {
  return { integration_id: integrationId };
}

/** status_snapshot = normalized_status de integration_order_status_mappings. */
export function snapshotStatusWhere(statuses: string[]): WhereOptions {
  return { status_snapshot: { [Op.in]: statuses } };
}
