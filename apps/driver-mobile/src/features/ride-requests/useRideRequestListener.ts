import { useEffect } from 'react'
import { socket } from '@/services/socket'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import type { RideRequestPayload } from './types'

// Mounted once at the root layout (same place the socket connect lifecycle
// already lives, per the plan's binding architecture decision) -- never
// per-screen, to avoid duplicate-subscription bugs on navigation.
export function useRideRequestListener(): void {
  const setPending = useRideRequestStore((s) => s.setPending)
  const clearPending = useRideRequestStore((s) => s.clearPending)

  useEffect(() => {
    function onRequest(payload: RideRequestPayload) {
      setPending(payload)
      // Clears the server-side redelivery key so a reconnect doesn't re-show
      // a request the driver has already seen (socket.server.ts's ack contract).
      socket.emit('ride:request:ack', { rideId: payload.rideId })
    }
    function onExpired({ rideId }: { rideId: string }) {
      clearPending(rideId)
    }
    socket.on('ride:request', onRequest)
    socket.on('ride:request_expired', onExpired)
    return () => {
      socket.off('ride:request', onRequest)
      socket.off('ride:request_expired', onExpired)
    }
  }, [setPending, clearPending])
}
