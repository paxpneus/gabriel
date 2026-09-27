import socketEmitterService from "../../../../handlers/socket/services/socket-emitter.service";
import {
  PDV_SOCKET_NAMESPACE,
  pdvSalesRequestRoom,
  PDV_SALES_REQUEST_UPDATED_EVENT,
} from "./pdv-sales-request-room";

// Sempre via redis-emitter (nunca SocketService direto, ver
// notify-pdv-store-sync.ts) — quem chama pode ser tanto o processo da API
// (attachReceipt, reconcileReceipts) quanto um worker sem servidor socket.io
// vivo (ex.: TCarUpsertQueue, ao terminar de enriquecer uma nota de
// transferência vinculada rápido — ver
// pdv-sales-request.service.ts::attachTransferInvoice e
// tecinco-api-fetch.queue.ts::processInvoiceTransfer). Front conectado na
// room desta solicitação só usa isso pra decidir refetch — nunca lê dado de
// negócio do payload.
export function notifySalesRequestUpdated(requestId: string): void {
  socketEmitterService.emitToNamespaceRoom(
    PDV_SOCKET_NAMESPACE,
    pdvSalesRequestRoom(requestId),
    PDV_SALES_REQUEST_UPDATED_EVENT,
    { requestId },
  );
}
