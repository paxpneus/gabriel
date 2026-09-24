// Fonte única pros dois lados (quem entra na room e quem emite pra ela) não
// divergirem — ver pdv-sales-request.socket.ts e attachReceipt.
export const PDV_SOCKET_NAMESPACE = "/pdv";

export function pdvSalesRequestRoom(requestId: string): string {
  return `pdv-sales-request:${requestId}`;
}

export const PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT =
  "payment-receipt-analysis:done";

// Emitido toda vez que a análise (individual ou conciliada) da solicitação
// muda — reconcileReceipts e updatePaymentReceiptAnalysis. Front só usa pra
// decidir refetch, mesmo espírito de PDV_STORE_SYNC_EVENT, nunca lê dado de
// negócio do payload.
export const PDV_SALES_REQUEST_UPDATED_EVENT = "salerequest-updated";

// Sync em tempo real do Kanban (sales-request/order) — ver notify-pdv-store-sync.ts.
// CD21 tem unit_business_id null (acesso global), por isso ganha uma room
// própria em vez de uma por loja.
export function pdvStoreRoom(unitBusinessId: string | number): string {
  return `pdv-store:${unitBusinessId}`;
}

export const PDV_CD21_ROOM = "pdv-cd21";

export const PDV_STORE_SYNC_EVENT = "pdv-store:sync";

// Front só usa isso pra decidir refetch, nunca lê o payload além disso —
// qualquer novo gatilho de sync deve entrar aqui.
export type PdvStoreSyncEventName =
  | "SALES_REQUEST_STATUS_CHANGED"
  | "ORDER_STATUS_CHANGED"
  | "NEW_ORDER";
