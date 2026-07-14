export interface ISocketEmitter {
  emitToUser<T>(userId: string | number, event: string, payload: T): void;
  emitToRoom<T>(room: string, event: string, payload: T): void;
  broadcast<T>(event: string, payload: T): void;
}