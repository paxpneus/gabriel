import { Op, WhereOptions } from "sequelize";
import { BLING_STATUS_DEFAULTS } from "../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import {
  completeCostSnapshotWhere,
  completedSnapshotWhere,
  snapshotIntegrationWhere,
  snapshotPeriodWhere,
  snapshotStatusWhere,
} from "../../../../../shared/query/query-objects/sales-snapshots/sales-order-snapshot.filters";

/** Final e não cancelado = Atendido, Enviado e Entregue; Em aberto fica de fora. */
export const INVOICED_STATUSES = BLING_STATUS_DEFAULTS.filter(
  (status) => status.is_final && !status.is_cancelled,
).map((status) => status.normalized_status);

/** Filtro único do relatório (linhas e totais); snapshotAlias muda entre include e model. */
export function invoicedReportWhere(
  integrationId: string,
  startDate: string,
  endDate: string,
  snapshotAlias: string,
): WhereOptions {
  return {
    [Op.and]: [
      snapshotIntegrationWhere(integrationId),
      snapshotStatusWhere(INVOICED_STATUSES),
      completedSnapshotWhere(),
      completeCostSnapshotWhere(snapshotAlias),
      snapshotPeriodWhere(startDate, endDate),
    ],
  };
}
