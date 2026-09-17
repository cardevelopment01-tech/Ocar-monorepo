import { useEffect } from 'react'
import type { Socket } from 'socket.io-client'

// createSocket.ts deliberately doesn't handle room membership -- Socket.IO doesn't
// remember rooms across reconnects, so a screen tracking a specific ride re-joins its
// ride:{rideId} room here, on mount AND on every 'connect' event (including
// reconnect-after-background). Matches the backend's only client-initiated room join,
// socket.on('join:ride', (rideId: string) => ...) in api/src/websocket/socket.server.ts
// -- driver:{id} and user:{id} rooms are auto-joined server-side on connect, no client
// join needed for those. Both rider-mobile (this phase) and driver-mobile (Days 9-10)
// join the same ride:{rideId} room during an active trip, hence the shared hook.
// onRejoined lets the caller pull a fresh snapshot (e.g. GET /rides/:id) after every
// join, since a reconnect alone doesn't replay events missed while disconnected.

// Extracted as a plain function (not inline in the hook) so it's unit-testable with a
// fake socket object, same injected-dependency pattern as createHybridStorage -- no
// React rendering harness needed.
export function attachRoomJoin(socket: Socket, rideId: string, onRejoined?: () => void): () => void {
  function join(): void {
    socket.emit('join:ride', rideId)
    onRejoined?.()
  }
  join()
  socket.on('connect', join)
  return () => socket.off('connect', join)
}

export function useRoomJoin(socket: Socket, rideId: string | null, onRejoined?: () => void): void {
  useEffect(() => {
    if (!rideId) return
    return attachRoomJoin(socket, rideId, onRejoined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onRejoined identity churn shouldn't re-join
  }, [socket, rideId])
}
