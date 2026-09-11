import { OrderInternalStatus } from "../orders.types";

// Rótulo em pt-BR pro internal_status — não usa integration_order_status_mappings.display_name
// de propósito: aquele é vinculado ao código bruto de situação da Bling
// (actual_situation), que diverge de internal_status na prática (ver
// CLAUDE.md, seção "Sales / orders"). Esse aqui é específico pro
// internal_status.
const ORDER_INTERNAL_STATUS_LABELS: Record<OrderInternalStatus, string> = {
  [OrderInternalStatus.OPEN]: "Em Aberto",
  [OrderInternalStatus.WAITING_CHANNEL_VALIDATION]:
    "Verificação de CNAE e Procurando Data de Coleta no Mercado Livre",
  [OrderInternalStatus.WAITING_FOR_NFE_EMISSION]:
    "Aguardando Emissão de Nota Fiscal",
  [OrderInternalStatus.EMITTED]: "NFe Emitida",
  [OrderInternalStatus.CANCELLED]: "Cancelado / Verificação Humana",
  [OrderInternalStatus.SENT_TO_TRANSPORTER]: "Enviado para Transportadora",
  [OrderInternalStatus.DELIVERED]: "Entregue ao Cliente",
  [OrderInternalStatus.UNKNOWN]: "Status Desconhecido",
};

export function translateOrderInternalStatus(
  status: string | null | undefined,
): string | null {
  if (!status) return null;
  return ORDER_INTERNAL_STATUS_LABELS[status as OrderInternalStatus] ?? status;
}
