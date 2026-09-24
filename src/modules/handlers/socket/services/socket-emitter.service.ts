// src/services/socket/SocketEmitterService.ts
import { Emitter } from "@socket.io/redis-emitter";
import Redis from "ioredis";
import { ISocketEmitter } from "./socket.types";
import { redisConnection } from "../../../../shared/utils/base-models/base-redis";

// `lazyConnect` (config/redis.ts) só evita conectar na hora do `new Redis()`
// — não evita nada quando um comando de verdade é emitido (Emitter.emit
// chama publish por baixo), e é exatamente isso que os métodos abaixo
// fazem. REDIS_HOST não existe/não é alcançável na maioria dos ambientes de
// teste, e com `maxRetriesPerRequest: null` (exigido pelo BullMQ, ver
// config/redis.ts) o ioredis fica reconectando pra sempre — handle que
// nunca fecha sozinho, trava a suíte ("Jest did not exit"/timeout) em
// qualquer teste que exercite um caminho de código que emite (ex.:
// bling-order.service.test.ts via createOrderFromBling/updateOrderFromBling
// → notifyPdvStoreSync). Mesma guarda de config/redis.ts, aplicada aqui
// porque é o emit em si que precisa ser pulado, não só a conexão.
const isRunningUnderJest = !!process.env.JEST_WORKER_ID;

class SocketEmitterService implements ISocketEmitter {
  private emitter: Emitter;

  constructor(pubClient: Redis) {
    this.emitter = new Emitter(pubClient);
  }

  emitToUser<T>(userId: string | number, event: string, payload: T): void {
    if (isRunningUnderJest) return;
    this.emitter.to(`user:${userId}`).emit(event, payload);
  }

  emitToRoom<T>(room: string, event: string, payload: T): void {
    if (isRunningUnderJest) return;
    this.emitter.to(room).emit(event, payload);
  }

  broadcast<T>(event: string, payload: T): void {
    if (isRunningUnderJest) return;
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
    if (isRunningUnderJest) return;
    this.emitter.of(namespace).to(room).emit(event, payload);
  }
}

// Singleton reaproveitando a mesma conexão Redis do resto do app (mesmo
// pubClient usado por SocketService.init() na API) — nenhum processo
// (worker-bling, worker-automation, etc.) precisa abrir conexão própria só
// pra emitir eventos de socket.
export const socketEmitterService = new SocketEmitterService(redisConnection);
export default socketEmitterService;