// What the app should do once it knows the server's view of the driver's session.
//
// The "Online" toggle is local state. The server can end a session without the app noticing (the stale-heartbeat
// sweep, a push that arrived while the app was backgrounded and its socket was down). Without reconciling, a phone
// that is warm-resumed keeps showing "Online" and pings a dead session while never being offered a ride.
export type SessionSyncAction = 'none' | 'go_online' | 'go_offline'

export function decideSessionSync(
  local: { isOnline: boolean; sessionId: string | null },
  server: { id: string } | null,
): SessionSyncAction {
  if (server === null) return local.isOnline ? 'go_offline' : 'none'
  if (!local.isOnline) return 'go_online'
  return local.sessionId === server.id ? 'none' : 'go_online'
}
