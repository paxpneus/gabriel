import socketEmitterService from "../../../../handlers/socket/services/socket-emitter.service";
import {
  PDV_CD21_ROOM,
  PDV_SOCKET_NAMESPACE,
  PDV_STORE_SYNC_EVENT,
  PdvStoreSyncDetail,
  PdvStoreSyncEventName,
  pdvStoreRoom,
} from "./pdv-sales-request-room";
import { PdvSalesRequestStatus } from "../pdv-sales-request.types";

// Fonte única de emissão pro Kanban em tempo real (sales-request e order) —
// sempre via redis-emitter (nunca SocketService direto), pra funcionar tanto
// no processo da API quanto nos workers (bling/automation), que não têm
// servidor socket.io vivo. CD21 tem acesso global (sem loja), por isso
// também recebe todo evento, além da room da loja específica.
export function notifyPdvStoreSync(
  unitBusinessId: string | number | null | undefined,
  event: PdvStoreSyncEventName,
  detail: PdvStoreSyncDetail = {},
): void {
  if (!unitBusinessId) return;

  const payload = { unitBusinessId, event, ...detail };
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

// Mudança em massa (ex.: lote finalizado) — 1 emissão por loja (só com as
// solicitações dela) e 1 só pro CD21 (com todas), nunca 1 por solicitação.
export function notifyPdvStoresSync(
  requests: {
    id: string;
    unit_business_id: string | null;
    status: PdvSalesRequestStatus;
  }[],
  event: PdvStoreSyncEventName,
): void {
  const byStore = new Map<string, PdvStoreSyncDetail["requests"]>();
  for (const request of requests) {
    if (!request.unit_business_id) continue;
    const storeRequests = byStore.get(request.unit_business_id) ?? [];
    storeRequests.push({ requestId: request.id, status: request.status });
    byStore.set(request.unit_business_id, storeRequests);
  }
  if (!byStore.size) return;

  byStore.forEach((storeRequests, unitBusinessId) =>
    socketEmitterService.emitToNamespaceRoom(
      PDV_SOCKET_NAMESPACE,
      pdvStoreRoom(unitBusinessId),
      PDV_STORE_SYNC_EVENT,
      { unitBusinessId, event, requests: storeRequests },
    ),
  );
  socketEmitterService.emitToNamespaceRoom(
    PDV_SOCKET_NAMESPACE,
    PDV_CD21_ROOM,
    PDV_STORE_SYNC_EVENT,
    { unitBusinessId: null, event, requests: [...byStore.values()].flat() },
  );
}
