// Fonte única pros dois lados (quem entra na room e quem emite pra ela) não
// divergirem — ver pdv-sales-request.socket.ts e attachReceiptAndShippingType.
export const PDV_SOCKET_NAMESPACE = "/pdv";

export function pdvSalesRequestRoom(requestId: string): string {
  return `pdv-sales-request:${requestId}`;
}

export const PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT =
  "payment-receipt-analysis:done";
