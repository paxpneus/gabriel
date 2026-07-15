import { ISocketEmitter } from './socket.types';
import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";

type SocketMiddleware = (socket: Socket, next: (err?: Error) => void) => void;
type SocketHandlerRegistrar = (io: Server, socket: Socket) => void;

class SocketService implements ISocketEmitter {
  private io: Server | null = null;

  init(
    httpServer: HttpServer,
    pubClient: Redis,
    options?: { cors?: { origin: string | string[]; credentials?: boolean } },
  ): Server {
    this.io = new Server(httpServer, {
      cors: options?.cors,
    });

    const subClient = pubClient.duplicate();
    this.io.adapter(createAdapter(pubClient, subClient));

    return this.io;
  }

  useMiddleware(middleware: SocketMiddleware): void {
    this.getIo().use(middleware);
  }

  registerHandlers(registrar: SocketHandlerRegistrar): void {
    this.getIo().on("connection", (socket) => {
      registrar(this.getIo(), socket);
    });
  }

  emitToUser<T>(userId: string | number, event: string, payload: T): void {
    this.getIo().to(`user:${userId}`).emit(event, payload);
  }

  emitToRoom<T>(room: string, event: string, payload: T): void {
    this.getIo().to(room).emit(event, payload);
  }

  broadcast<T>(event: string, payload: T): void {
    this.getIo().emit(event, payload);
  }

  private getIo(): Server {
    if (!this.io) {
      throw new Error("SocketService não foi inicializado. Chame init() primeiro.");
    }
    return this.io;
  }
}

export const socketService = new SocketService();
export default socketService;