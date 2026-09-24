import { Socket } from "socket.io";
import socketService from "../../../handlers/socket/services/socket.service";
import {
  pdvSocketAuthMiddleware,
  PdvSocketData,
} from "../pdv-access/pdv-socket-auth.middleware";
import pdvSalesRequestService from "./pdv-sales-request.service";
import {
  PDV_CD21_ROOM,
  PDV_SOCKET_NAMESPACE,
  pdvSalesRequestRoom,
  pdvStoreRoom,
} from "./helpers/pdv-sales-request-room";

const WATCH_EVENT = "pdv-sales-request:watch";

type WatchAck = (result: { ok: boolean; error?: string }) => void;

// Cliente conecta e emite WATCH_EVENT com o id da solicitação recém-anexada
// pra entrar na room e receber a análise quando terminar (ver
// PdvSalesRequestService.attachReceiptAndShippingType).
export function registerPdvSocketNamespace(): void {
  const namespace = socketService.of(PDV_SOCKET_NAMESPACE);
  namespace.use(pdvSocketAuthMiddleware);

  namespace.on("connection", (socket: Socket) => {
    // Auto-join na room de sync do Kanban — unitBusinessId já vem resolvido/
    // autenticado pelo middleware (login ou link), sem exigir evento próprio
    // do front. CD21 (unitBusinessId null, acesso global) entra na room
    // própria em vez de uma por loja (ver notify-pdv-store-sync.ts).
    const access = (socket.data as PdvSocketData).pdvAccess;
    if (access.unitBusinessId) {
      socket.join(pdvStoreRoom(access.unitBusinessId));
    } else {
      socket.join(PDV_CD21_ROOM);
    }

    socket.on(
      WATCH_EVENT,
      async (payload: { requestId?: string }, callback?: WatchAck) => {
        try {
          const requestId = payload?.requestId;
          if (!requestId) {
            callback?.({ ok: false, error: "requestId é obrigatório" });
            return;
          }

          // Mesmo scoping de assertOwnedByAccess (pdv-sales-request.controller.ts):
          // CD21/Financeiro (unitBusinessId null, acesso global) veem
          // qualquer solicitação, as outras só a da própria loja.
          const access = (socket.data as PdvSocketData).pdvAccess;
          const record = await pdvSalesRequestService.findById(requestId);

          if (
            !record ||
            (access.unitBusinessId !== null &&
              record.unit_business_id !== access.unitBusinessId)
          ) {
            callback?.({ ok: false, error: "Não encontrado" });
            return;
          }

          socket.join(pdvSalesRequestRoom(requestId));
          callback?.({ ok: true });
        } catch (error: any) {
          callback?.({ ok: false, error: error.message });
        }
      },
    );
  });
}
