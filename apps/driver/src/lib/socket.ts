import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/store/useAuthStore'

let socket: Socket | null = null
let refreshInProgress = false

async function refreshSocketToken(): Promise<string> {
  const { refreshToken, driver, setAuth } = useAuthStore.getState()
  if (!refreshToken || !driver) throw new Error('no_refresh_token')
  // Use bare axios (not the api instance) to avoid the response interceptor loop
  const res = await axios.post<{ tokens: { accessToken: string; refreshToken: string } }>(
    `${import.meta.env['VITE_API_URL'] as string}/api/v1/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
  )
  const tokens = res.data.tokens
  setAuth(tokens.accessToken, tokens.refreshToken, driver)
  return tokens.accessToken
}

export function getDriverSocket(): Socket {
  const token = useAuthStore.getState().token
  if (!socket) {
    socket = io(import.meta.env['VITE_API_URL'] as string, {
      auth: { token },
      // Must match the server's websocket-only transport (no ALB sticky
      // sessions configured -- see api/src/websocket/socket.server.ts).
      transports: ['websocket'],
      autoConnect: false,
    })

    // When the server rejects the connection due to an expired/invalid token,
    // refresh and retry once. All other connect_error causes (network down, server
    // unreachable) are left to Socket.IO's built-in exponential back-off.
    socket.on('connect_error', (err) => {
      const isAuthError =
        err.message === 'Invalid token' || err.message === 'Authentication required'
      if (!isAuthError || refreshInProgress) return

      refreshInProgress = true
      refreshSocketToken()
        .then((newToken) => {
          if (socket) {
            socket.auth = { token: newToken }
            socket.connect()
          }
        })
        .catch(() => {
          // Refresh token itself is expired, force re-login
          useAuthStore.getState().clearAuth()
          window.location.href = '/login'
        })
        .finally(() => {
          refreshInProgress = false
        })
    })
  } else {
    // Keep auth current so the next reconnect attempt uses the latest token
    socket.auth = { token }
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
  refreshInProgress = false
}
