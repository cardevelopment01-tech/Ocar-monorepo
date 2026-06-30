import { io, type Socket } from 'socket.io-client'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'

let adminSocket: Socket | null = null

export function getAdminSocket(): Socket {
  if (!adminSocket || !adminSocket.connected) {
    const token = typeof window !== 'undefined' ? (localStorage.getItem('ocar_admin_token') ?? '') : ''
    adminSocket = io(API_URL, {
      auth:               { token },
      transports:         ['websocket'],
      reconnectionAttempts: 5,
    })
  }
  return adminSocket
}

export function disconnectAdminSocket() {
  adminSocket?.disconnect()
  adminSocket = null
}
