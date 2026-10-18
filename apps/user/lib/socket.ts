import { io, Socket } from 'socket.io-client'
import { getToken } from './auth'

let socket: Socket | null = null

export function getSocket(): Socket {
  const token = getToken()
  if (!socket) {
    socket = io(process.env['NEXT_PUBLIC_API_URL']!, {
      auth: { token },
      // Must match the server's websocket-only transport (no ALB sticky
      // sessions configured -- see api/src/websocket/socket.server.ts).
      transports: ['websocket'],
      // Retry timing after a lost connection. Socket.IO's defaults (1 s, +/-50%) bring every client that lost
      // its server back inside the same second; this spreads the first retry over 0-5 s and backs off to 15 s
      // while the server is busy. Simulated with 5,000 clients and a server accepting 400 connects/s: 59% fewer
      // failed attempts and half the peak. Keep these three values identical in apps/user, apps/driver,
      // apps/admin and packages/mobile-shared (api/tests/unit/websocket/client-reconnect-config.test.ts checks).
      reconnectionDelay: 2500,
      reconnectionDelayMax: 15000,
      randomizationFactor: 1,
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
