import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/store/useAuthStore'

let socket: Socket | null = null

export function getDriverSocket(): Socket {
  if (!socket) {
    const token = useAuthStore.getState().token
    socket = io(import.meta.env['VITE_API_URL'] as string, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: false,
    })
  }
  return socket
}

export function connectDriverSocket(): void {
  const s = getDriverSocket()
  if (!s.connected) s.connect()
}

export function disconnectDriverSocket(): void {
  socket?.disconnect()
  socket = null
}
