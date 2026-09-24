import socketEmitterService from "../../../../handlers/socket/services/socket-emitter.service";
import {
  PDV_CD21_ROOM,
  PDV_SOCKET_NAMESPACE,
  PDV_STORE_SYNC_EVENT,
  PdvStoreSyncEventName,
  pdvStoreRoom,
} from "./pdv-sales-request-room";

// Fonte única de emissão pro Kanban em tempo real (sales-request e order) —
// sempre via redis-emitter (nunca SocketService direto), pra funcionar tanto
// no processo da API quanto nos workers (bling/automation), que não têm
// servidor socket.io vivo. CD21 tem acesso global (sem loja), por isso
// também recebe todo evento, além da room da loja específica.
export function notifyPdvStoreSync(
  unitBusinessId: string | number | null | undefined,
  event: PdvStoreSyncEventName,
): void {
  if (!unitBusinessId) return;

  const payload = { unitBusinessId, event };
  socketEmitterService.emitToNamespaceRoom(
    PDV_SOCKET_NAMESPACE,
    pdvStoreRoom(unitBusinessId),
    PDV_STORE_SYNC_EVENT,
    payload,
  );
  socketEmitterService.emitToNamespaceRoom(
    PDV_SOCKET_NAMESPACE,
    PDV_CD21_ROOM,
    PDV_STORE_SYNC_EVENT,
    payload,
  );
}
