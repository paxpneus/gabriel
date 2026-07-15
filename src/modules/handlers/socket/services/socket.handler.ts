import { Server, Socket } from 'socket.io'

export function registerSocketHandlers(io: Server, socket: Socket) {
    socket.join(`user:${socket.data.user.id}`)

  console.log(`usuário ${socket.data.user.id } conectado via socket`)

  socket.on('ping:teste', () => {
    console.log(`recebi ping:teste de ${socket.data.user.id}`)
    socket.emit('pong:teste', { hora: new Date().toISOString() })
  })
  // -------------------------------------------------------

  socket.on('disconnect', () => {
    console.log(`usuário ${socket.data} desconectou`)
  })
}