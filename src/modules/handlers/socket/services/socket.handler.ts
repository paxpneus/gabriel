import { Server, Socket } from 'socket.io'

export function registerSocketHandlers(io: Server, socket: Socket) {
  socket.join(`user:${socket.data.userId}`)

  console.log(`usuário ${socket.data.userId} conectado via socket`)

  socket.on('disconnect', () => {
    console.log(`usuário ${socket.data.userId} desconectou`)
  })
}