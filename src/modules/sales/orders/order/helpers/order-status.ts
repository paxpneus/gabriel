// src/shared/utils/normalizers/bling/sync-order-internal-status.ts

import ordersService from "../../../../../modules/sales/orders/order/orders.service";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  OrderInternalStatus,
} from "../../../../../modules/sales/orders/order/orders.types";
import { mapOrderInternalStatus } from "../../../../../shared/utils/normalizers/bling/status-mapper";

export type OrderStatusSyncResult =
  | { handled: true; outcome: "completed"; internalStatus: OrderInternalStatus }
  | { handled: true; outcome: "cancelled"; internalStatus: OrderInternalStatus }
  | { handled: false; internalStatus: OrderInternalStatus };

/**
 * Resolve o status bruto vindo da Bling (situacao.id), mapeia pro
 * internal_status normalizado, e sincroniza o pedido no banco quando o
 * status já representa um estado "terminal" conhecido (completo ou
 * cancelado).
 *
 * - Se mappedStatus estiver em COMPLETED_ORDER_INTERNAL_STATUSES (EMITTED,
 *   SENT_TO_TRANSPORTER, DELIVERED): marca nfe_emitted=true e grava o
 *   internal_status real (não força "EMITTED" fixo).
 * - Se mappedStatus for CANCELLED: marca nfe_emitted=false e grava CANCELLED.
 * - Caso contrário (UNKNOWN, WAITING_*, etc): não mexe no banco — quem
 *   chamou decide o que fazer (ex: markOrderCancelled por status inesperado).
 *
 * Retorna sempre o internalStatus mapeado, mesmo quando handled=false, pra
 * quem chamou poder logar/decidir sem precisar mapear de novo.
 */
export const syncOrderInternalStatus = async (
  blingSituationId: string | number,
  orderId: string | number,
): Promise<OrderStatusSyncResult> => {
  const mappedStatus = mapOrderInternalStatus(blingSituationId);

  const internalOrder = await ordersService.findOne({
    where: { id_order_system: String(orderId) },
  });

  if (!internalOrder) {
    return { handled: false, internalStatus: mappedStatus };
  }

  if (COMPLETED_ORDER_INTERNAL_STATUSES.includes(mappedStatus)) {
    await ordersService.update(internalOrder.id, {
      nfe_emitted: true,
      internal_status: mappedStatus,
    });

    return { handled: true, outcome: "completed", internalStatus: mappedStatus };
  }

  if (mappedStatus === OrderInternalStatus.CANCELLED) {
    await ordersService.update(internalOrder.id, {
      nfe_emitted: false,
      internal_status: mappedStatus,
    });

    return { handled: true, outcome: "cancelled", internalStatus: mappedStatus };
  }

  return { handled: false, internalStatus: mappedStatus };
};