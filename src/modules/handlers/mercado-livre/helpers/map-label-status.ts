import { MarketPlaceLabelStatus } from "../../../sales/orders/order/orders.types";

// Traduz o status/substatus cru de GET /shipments/:id do Mercado Livre pro
// enum genérico MarketPlaceLabelStatus. WAITING_FOR_SYSTEM_NFE fica de fora
// de propósito — é atribuído só na ingestão pelo próprio sistema
// (bling-order.service.ts), nunca derivado do vocabulário do ML. Cada
// marketplace futuro (Shopee) ganha seu próprio map-label-status.ts, mesma
// assinatura, mesmo enum de destino.
export function mapMercadoLivreLabelStatus(
  rawStatus: string | null,
  rawSubstatus: string | null,
): MarketPlaceLabelStatus {
  if (
    rawStatus === "ready_to_ship" &&
    ["ready_to_print", "printed"].includes(rawSubstatus ?? "")
  ) {
    return MarketPlaceLabelStatus.READY_TO_PRINT;
  }

  if (["invoice_pending", "waiting_for_invoice"].includes(rawSubstatus ?? "")) {
    return MarketPlaceLabelStatus.WAITING_MARKETPLACE_PROCESS_NFE;
  }

  if (["waiting_for_label_generation", "buffered"].includes(rawSubstatus ?? "")) {
    return MarketPlaceLabelStatus.WAITING_MARKETPLACE_LABEL_GENERATION;
  }

  return MarketPlaceLabelStatus.UNKNOWN;
}
