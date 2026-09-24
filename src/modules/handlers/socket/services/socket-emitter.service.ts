// src/services/socket/SocketEmitterService.ts
import { Emitter } from "@socket.io/redis-emitter";
import Redis from "ioredis";
import { ISocketEmitter } from "./socket.types";
import { redisConnection } from "../../../../shared/utils/base-models/base-redis";

class SocketEmitterService implements ISocketEmitter {
  private emitter: Emitter;

  constructor(pubClient: Redis) {
    this.emitter = new Emitter(pubClient);
  }

  emitToUser<T>(userId: string | number, event: string, payload: T): void {
    this.emitter.to(`user:${userId}`).emit(event, payload);
  }

  emitToRoom<T>(room: string, event: string, payload: T): void {
    this.emitter.to(room).emit(event, payload);
  }

  broadcast<T>(event: string, payload: T): void {
    this.emitter.emit(event, payload);
  }

  // Namespace próprio (ex.: "/pdv") — espelha SocketService.emitToNamespaceRoom,
  // pra quem emite de um processo sem servidor socket.io vivo (worker) usar a
  // mesma assinatura. Publica via Redis pub/sub; o servidor com o adapter
  // (server.ts) é quem entrega de fato pros sockets conectados.
  emitToNamespaceRoom<T>(
    namespace: string,
    room: string,
    event: string,
    payload: T,
  ): void {
    this.emitter.of(namespace).to(room).emit(event, payload);
  }
}

// Singleton reaproveitando a mesma conexão Redis do resto do app (mesmo
// pubClient usado por SocketService.init() na API) — nenhum processo
// (worker-bling, worker-automation, etc.) precisa abrir conexão própria só
// pra emitir eventos de socket.
export const socketEmitterService = new SocketEmitterService(redisConnection);
export default socketEmitterService;