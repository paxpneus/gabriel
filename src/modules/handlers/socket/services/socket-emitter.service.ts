// src/services/socket/SocketEmitterService.ts
import { Emitter } from "@socket.io/redis-emitter";
import Redis from "ioredis";
import { ISocketEmitter } from "./socket.types";

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
}

export default SocketEmitterService;