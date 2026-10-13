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
//
// Several screens can watch the same ride at once (ride screen + chat pushed on top), so
// membership is ref-counted per socket+ride: 'leave:ride' goes out only when the LAST
// watcher unmounts. Without the leave, the server keeps streaming driver:location to a
// phone that has no listener (and, for old completed trips, forever).
//
// skipInitialRejoin: the caller already fetches on mount itself, so only reconnects
// should call onRejoined (avoids a duplicate GET on screen open).
const watchers = new WeakMap<Socket, Map<string, number>>()

export function attachRoomJoin(
  socket: Socket,
  rideId: string,
  onRejoined?: () => void,
  opts: { skipInitialRejoin?: boolean } = {},
): () => void {
  const counts = watchers.get(socket) ?? new Map<string, number>()
  watchers.set(socket, counts)
  counts.set(rideId, (counts.get(rideId) ?? 0) + 1)

  function join(): void {
    socket.emit('join:ride', rideId)
    onRejoined?.()
  }
  socket.emit('join:ride', rideId)
  if (!opts.skipInitialRejoin) onRejoined?.()
  socket.on('connect', join)
  return () => {
    socket.off('connect', join)
    const left = (counts.get(rideId) ?? 1) - 1
    if (left <= 0) {
      counts.delete(rideId)
      socket.emit('leave:ride', rideId)
    } else {
      counts.set(rideId, left)
    }
  }
}

export function useRoomJoin(
  socket: Socket,
  rideId: string | null,
  onRejoined?: () => void,
  opts?: { skipInitialRejoin?: boolean },
): void {
  useEffect(() => {
    if (!rideId) return
    return attachRoomJoin(socket, rideId, onRejoined, opts)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onRejoined identity churn shouldn't re-join
  }, [socket, rideId])
}
