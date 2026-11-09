import { parseCarEvent, type CarEvent } from './liveCars'

// The few socket methods this needs, so it is testable with a fake and does not depend on the socket library's types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the real socket's listener type is (...args: any[]) => void
type Listener = (...args: any[]) => void
export type NearbySocket = {
  emit: (event: string, ...args: unknown[]) => unknown
  on: (event: string, listener: Listener) => unknown
  off: (event: string, listener: Listener) => unknown
}

// Subscribe a searching ride to the live cars around its pickup. The server derives the area from the rider's own ride, so
// the only thing sent is the ride id. A socket forgets its rooms when it reconnects, so the subscription is re-sent on every
// 'connect' (including reconnect after the app was in the background). Same injected-socket pattern as attachRoomJoin, so it
// is testable with a fake socket and no React.

/** Returns the function that undoes it: unsubscribes and removes the listeners. */
export function attachNearbyCars(
  socket: NearbySocket,
  rideId: string,
  onCar: (car: CarEvent) => void,
): () => void {
  const subscribe = () => { socket.emit('nearby:subscribe', { rideId }) }
  const onMessage = (raw: unknown) => {
    const car = parseCarEvent(raw)
    if (car) onCar(car)
  }
  subscribe()
  socket.on('connect', subscribe)
  socket.on('nearby:car', onMessage)
  return () => {
    socket.off('connect', subscribe)
    socket.off('nearby:car', onMessage)
    socket.emit('nearby:unsubscribe')
  }
}
