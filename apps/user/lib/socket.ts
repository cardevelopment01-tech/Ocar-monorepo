import { io, Socket } from 'socket.io-client'
import { getToken } from './auth'

let socket: Socket | null = null

export function getSocket(): Socket {
  const token = getToken()
  if (!socket) {
    socket = io(process.env['NEXT_PUBLIC_API_URL']!, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: false,
    })
  } else {
    socket.auth = { token }
  }
  return socket
}

export function connectSocket(): void {
  const s = getSocket()
  if (!s.connected) s.connect()
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}

export function joinRideRoom(rideId: string): void {
  getSocket().emit('join:ride', rideId)
}

export function leaveRideRoom(rideId: string): void {
  getSocket().emit('leave:ride', rideId)
}
