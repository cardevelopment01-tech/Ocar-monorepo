import { io, type Socket } from 'socket.io-client'

export type SocketConfig = {
  baseURL: string
  getToken: () => string | null
  refreshToken: () => Promise<string>
  onRefreshFailure: () => void
}

export type SocketHandle = {
  socket: Socket
  connect: () => void
  disconnect: () => void
}

// Mirrors apps/driver/src/lib/socket.ts's reconnect/refresh contract, generalized over
// per-app token storage. Room membership (join:ride, driver:{id}, user:{id}) is NOT
// handled here -- each app's own services/socket/ re-emits joins on every 'connect'
// event, since Socket.IO does not remember room membership across reconnects.
export function createSocket(config: SocketConfig): SocketHandle {
  const { baseURL, getToken, refreshToken, onRefreshFailure } = config
  let refreshInProgress = false

  const socket: Socket = io(baseURL, {
    auth: { token: getToken() },
    // Must match the backend's websocket-only transport (no ALB sticky sessions --
    // see api/src/websocket/socket.server.ts).
    transports: ['websocket'],
    autoConnect: false,
  })

  socket.on('connect_error', (err) => {
    const isAuthError = err.message === 'Invalid token' || err.message === 'Authentication required'
    if (!isAuthError || refreshInProgress) return

    refreshInProgress = true
    refreshToken()
      .then((newToken) => {
        socket.auth = { token: newToken }
        socket.connect()
      })
      .catch(() => {
        onRefreshFailure()
      })
      .finally(() => {
        refreshInProgress = false
      })
  })

  function connect(): void {
    socket.auth = { token: getToken() }
    if (!socket.connected) socket.connect()
  }

  function disconnect(): void {
    socket.disconnect()
  }

  return { socket, connect, disconnect }
}
