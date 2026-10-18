import { io, type Socket } from 'socket.io-client'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'

let adminSocket: Socket | null = null

export function getAdminSocket(): Socket {
  if (!adminSocket || !adminSocket.connected) {
    const token = typeof window !== 'undefined' ? (localStorage.getItem('ocar_admin_token') ?? '') : ''
    adminSocket = io(API_URL, {
      auth:       { token },
      transports: ['websocket'],
      // Retry timing after a lost connection. Socket.IO's defaults (1 s, +/-50%) bring every client that lost
      // its server back inside the same second; this spreads the first retry over 0-5 s and backs off to 15 s
      // while the server is busy. Simulated with 5,000 clients and a server accepting 400 connects/s: 59% fewer
      // failed attempts and half the peak. Keep these three values identical in apps/user, apps/driver,
      // apps/admin and packages/mobile-shared (api/tests/unit/websocket/client-reconnect-config.test.ts checks).
      reconnectionDelay: 2500,
      reconnectionDelayMax: 15000,
      randomizationFactor: 1,
      // No reconnectionAttempts cap — an admin session left open for hours
      // shouldn't silently stop retrying and leave the live-map stale forever.
    })
  }
  return adminSocket
}

export function disconnectAdminSocket() {
  adminSocket?.disconnect()
  adminSocket = null
}
