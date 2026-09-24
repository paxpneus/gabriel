// src/shared/utils/normalizers/bling/sync-order-internal-status.ts

import { AxiosInstance } from "axios";
import ordersService from "../../../../../modules/sales/orders/order/orders.service";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  OrderInternalStatus,
  OrderReasonCancelled,
} from "../../../../../modules/sales/orders/order/orders.types";
import { mapOrderInternalStatus } from "../../../../../shared/utils/normalizers/bling/status-mapper";
import {
  blingGet,
  blingPatch,
} from "../../../../../modules/handlers/bling/services/bling/helpers/get-with-sleep";
import pdvSalesRequestService from "../../../pdv-management/sales-request/pdv-sales-request.service";
import { notifyPdvStoreSync } from "../../../pdv-management/sales-request/helpers/notify-pdv-store-sync";

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
 *
 * `reasonCancelled` é opcional e só é gravado quando o outcome é
 * "cancelled" — quem chama sem saber o motivo (ex: NFeQueue resincronizando
 * a situação atual da Bling) simplesmente omite o parâmetro.
 */
export const syncOrderInternalStatus = async (
  blingSituationId: string | number,
  orderId: string | number,
  reasonCancelled?: OrderReasonCancelled,
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
    notifyPdvStoreSync(internalOrder.unit_business_id, "ORDER_STATUS_CHANGED");

    return { handled: true, outcome: "completed", internalStatus: mappedStatus };
  }

  if (mappedStatus === OrderInternalStatus.CANCELLED) {
    await ordersService.update(internalOrder.id, {
      nfe_emitted: false,
      internal_status: mappedStatus,
      ...(reasonCancelled ? { reason_cancelled: reasonCancelled } : {}),
    });
    notifyPdvStoreSync(internalOrder.unit_business_id, "ORDER_STATUS_CHANGED");

    // Cancela sozinho uma PdvSalesRequest ativa pro pedido — diferente de
    // handleInvoiceCancelled (nota cancelada bloqueia pra decisão humana),
    // aqui o pedido em si já foi cancelado na origem, não há o que decidir.
    await pdvSalesRequestService.cancelIfActiveByOrderId(internalOrder.id);

    return { handled: true, outcome: "cancelled", internalStatus: mappedStatus };
  }

  return { handled: false, internalStatus: mappedStatus };
};

const HUMAN_VERIFICATION_SITUACAO_ID = 748772;

export type EscalateToHumanVerificationResult =
  | { escalated: true }
  | {
      escalated: false;
      reason: "already-terminal" | "unexpected-status" | "order-not-found";
      internalStatus: OrderInternalStatus;
    };

/**
 * Ponto único de decisão pra "marcar pedido como verificação humana"
 * (situação Bling 748772) — toda fila que precisa escalar um pedido deve
 * passar por aqui, em vez de decidir e fazer o PATCH por conta própria.
 *
 * Sempre busca a situação AO VIVO na Bling antes de decidir (nunca confia
 * numa checagem feita antes, ainda que segundos atrás — o objetivo é evitar
 * escalar um pedido que já se resolveu sozinho entre a checagem antiga e
 * agora):
 *
 * 1. Se a situação ao vivo já é terminal (EMITTED/SENT_TO_TRANSPORTER/
 *    DELIVERED/CANCELLED — via `syncOrderInternalStatus`), NUNCA escala:
 *    "Enviado para transporte", "Entregue", "Atendido" e "Cancelado" nunca
 *    devem ser sobrescritos por uma verificação humana. O banco já fica
 *    sincronizado com a realidade nesse caminho (feito pelo próprio
 *    `syncOrderInternalStatus`).
 * 2. Se não é terminal, só escala se o status mapeado estiver em
 *    `allowedPendingStatuses` — a precondição específica de quem chamou
 *    (ex: CNPJ_VERIFY_CNAE só escala a partir de OPEN; NFE_EMISSION só a
 *    partir de WAITING_FOR_NFE_EMISSION, e só porque a própria emissão
 *    falhou). Se o status real não bate com o esperado, também não escala
 *    — só sincroniza o internal_status pra refletir a realidade.
 * 3. Só quando as duas condições acima permitem: roda o hook opcional
 *    `beforeEscalate` (pra quem chama poder gravar sua própria observação
 *    na Bling e respeitar seu próprio espaçamento, exatamente como antes —
 *    só que agora depois de confirmado que vai escalar mesmo, não antes) e
 *    então faz o PATCH pra 748772 + grava CANCELLED/nfe_emitted=false/
 *    reason_cancelled no banco.
 */
export async function escalateToHumanVerificationIfStillPending({
  idOrderSystem,
  blingApi,
  allowedPendingStatuses,
  reasonCancelled,
  beforeEscalate,
}: {
  idOrderSystem: string | number;
  blingApi: AxiosInstance;
  allowedPendingStatuses: OrderInternalStatus[];
  reasonCancelled: OrderReasonCancelled;
  beforeEscalate?: (liveOrderData: any) => Promise<void>;
}): Promise<EscalateToHumanVerificationResult> {
  const { data } = await blingGet(`/pedidos/vendas/${idOrderSystem}`, blingApi);
  const liveOrderData = data.data;
  const situacaoId = liveOrderData?.situacao?.id;
  const mappedStatus = mapOrderInternalStatus(situacaoId);

  const syncResult = await syncOrderInternalStatus(situacaoId, idOrderSystem);
  if (syncResult.handled) {
    return {
      escalated: false,
      reason: "already-terminal",
      internalStatus: mappedStatus,
    };
  }

  if (!allowedPendingStatuses.includes(mappedStatus)) {
    const order = await ordersService.findOne({
      where: { id_order_system: String(idOrderSystem) },
    });
    if (order) {
      await ordersService.update(order.id, { internal_status: mappedStatus });
      notifyPdvStoreSync(order.unit_business_id, "ORDER_STATUS_CHANGED");
    }
    return {
      escalated: false,
      reason: "unexpected-status",
      internalStatus: mappedStatus,
    };
  }

  if (beforeEscalate) {
    await beforeEscalate(liveOrderData);
  }

  await blingPatch(
    `/pedidos/vendas/${idOrderSystem}/situacoes/${HUMAN_VERIFICATION_SITUACAO_ID}`,
    { id: HUMAN_VERIFICATION_SITUACAO_ID },
    blingApi,
  );

  const order = await ordersService.findOne({
    where: { id_order_system: String(idOrderSystem) },
  });
  if (!order) {
    return {
      escalated: false,
      reason: "order-not-found",
      internalStatus: mappedStatus,
    };
  }

  await ordersService.update(order.id, {
    internal_status: OrderInternalStatus.CANCELLED,
    nfe_emitted: false,
    reason_cancelled: reasonCancelled,
  });
  notifyPdvStoreSync(order.unit_business_id, "ORDER_STATUS_CHANGED");

  await pdvSalesRequestService.cancelIfActiveByOrderId(order.id);

  return { escalated: true };
}