import { Op, WhereOptions } from "sequelize";
import { BLING_STATUS_DEFAULTS } from "../../integration-order-status-mapping/integration-order-status-mapping.service";

/** Mesmo critério do sales-invoiced-report (final e não cancelado: Atendido, Enviado, Entregue), em situação Bling. */
export const INVOICED_ORDER_SITUATIONS = BLING_STATUS_DEFAULTS.filter(
  (status) => status.is_final && !status.is_cancelled,
).map((status) => status.external_status_id);

export const OPEN_ORDER_SITUATIONS = BLING_STATUS_DEFAULTS.filter(
  (status) => status.normalized_status === "EM_ABERTO",
).map((status) => status.external_status_id);

/** Faturado pelo status (nota opcional) ou em aberto já com nota vinculada. */
export function invoicedSalesDetailOrderWhere(): WhereOptions {
  return {
    [Op.or]: [
      { actual_situation: { [Op.in]: INVOICED_ORDER_SITUATIONS } },
      {
        actual_situation: { [Op.in]: OPEN_ORDER_SITUATIONS },
        invoice_id: { [Op.ne]: null },
      },
    ],
  };
}

/** Lojas numeradas + loja do site (sem número); vendedor válido é filtrado à parte. */
export function salesDetailUnitBusinessWhere(
  websitePaxUnitBusinessId: string | null,
): WhereOptions {
  const numbered = { number: { [Op.ne]: null } };
  if (!websitePaxUnitBusinessId) return numbered;

  return { [Op.or]: [numbered, { id: websitePaxUnitBusinessId }] };
}
