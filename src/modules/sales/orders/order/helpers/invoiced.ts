import { BLING_STATUS_DEFAULTS } from "../../integration-order-status-mapping/integration-order-status-mapping.service";
import { invoiceCancelledSql } from "../../../../warehouse/fiscal/invoices/invoice";

// Situação final e não cancelada no Bling (Atendido, Enviado, Entregue), pelo `orders.actual_situation`.
export const FINAL_ORDER_SITUATIONS = BLING_STATUS_DEFAULTS.filter(
  (status) => status.is_final && !status.is_cancelled,
).map((status) => status.external_status_id);

// Pedido em situação final no Bling (Atendido, Enviado ou Entregue), com ou sem nota.
export function orderFinalSituationSql(orderAlias: string): string {
  return `(${orderAlias}.actual_situation IN (${FINAL_ORDER_SITUATIONS.map((id) => `'${id}'`).join(", ")}))`;
}

// Faturado = situação final + nota de venda vinculada e não cancelada; só pedido faturado gera comissão nos relatórios.
export function orderInvoicedSql(orderAlias: string): string {
  return `(${orderFinalSituationSql(orderAlias)}
    AND ${orderAlias}.invoice_id IS NOT NULL
    AND NOT ${invoiceCancelledSql(`${orderAlias}.invoice_id`)})`;
}
