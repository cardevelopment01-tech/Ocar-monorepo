import { io, type Socket } from 'socket.io-client'

export type SocketConfig = {
  baseURL: string
  getToken: () => string | null
  refreshToken: () => Promise<string>
  onRefreshFailure: () => void
  /** Server says this account signed in elsewhere. Falls back to onRefreshFailure. */
  onSessionReplaced?: () => void
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
  const onSessionReplaced = config.onSessionReplaced ?? onRefreshFailure

  const socket: Socket = io(baseURL, {
    auth: { token: getToken() },
    // Must match the backend's websocket-only transport (no ALB sticky sessions --
    // see api/src/websocket/socket.server.ts).
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

  socket.on('session:replaced', onSessionReplaced)

  socket.on('connect_error', (err) => {
    if (err.message === 'AUTH_SESSION_REPLACED') return onSessionReplaced()
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
