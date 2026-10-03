import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import axios from 'axios'
import { useRoomJoin, type RideDetail } from '@ocar/mobile-shared'
import { connectSocket, socket } from '@/services/socket'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import {
  cancelRideAsDriver,
  fetchRide,
  fetchUnreadChatCount,
  markArrived as apiMarkArrived,
  startReturn,
  arrivedAtDrop,
  submitCashCollection,
  submitEndOtp,
  submitStartOtp,
} from './api'
import { activeRideReducer, displayStatus, type RideStatus } from './reducer'
import { externalEndMessage, type ExternalEndInfo } from './externalEnd'

function isInvalidOtp(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 422
}

// GET /rides/:id's own query already joins payments and returns these
// (rides.repository.ts's getRideById), same fields web's TripEnd.tsx polls
// for -- just not declared on the shared RideDetail type since only the
// completed-trip screen needs them.
export type RideDetailSettled = RideDetail & {
  commissionAmount?: string | null
  driverEarning?: string | null
  paymentChannel?: string | null
}

export function useActiveRide(rideId: string) {
  const [ride, setRide] = useState<RideDetailSettled | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [state, dispatch] = useReducer(activeRideReducer, {
    confirmedStatus: 'accepted',
    pendingOptimisticStatus: null,
  })
  const setActiveRideSummary = useDriverSessionStore((s) => s.setActiveRide)
  // Set once the ride was ended by someone else (rider/system cancel, admin force-resolve).
  // The screen reacts by leaving -- see externalEnd.ts.
  const [endedExternally, setEndedExternally] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchRide(rideId)
      .then((detail) => {
        const endMessage = externalEndMessage(detail.status, detail.resolvedBy ? { resolvedBy: detail.resolvedBy } : {})
        if (endMessage) {
          setEndedExternally(endMessage)
          return
        }
        setRide(detail as RideDetailSettled)
        dispatch({ type: 'confirmed', status: detail.status as RideStatus })
        setLoadError(false)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [rideId])

  useEffect(() => {
    load()
  }, [load])

  // Refetch without the loading skeleton -- `load` swaps the whole screen (map,
  // guided nav) for a skeleton, which is wrong for a stop added mid-navigation.
  const refreshSeq = useRef(0)
  const refresh = useCallback(() => {
    // Two events back to back (add + reorder) can return out of order; only the
    // latest request may overwrite the ride.
    const seq = ++refreshSeq.current
    fetchRide(rideId)
      .then((detail) => {
        if (seq !== refreshSeq.current) return
        const endMessage = externalEndMessage(detail.status, detail.resolvedBy ? { resolvedBy: detail.resolvedBy } : {})
        if (endMessage) {
          setEndedExternally(endMessage)
          return
        }
        setRide(detail as RideDetailSettled)
        dispatch({ type: 'confirmed', status: detail.status as RideStatus })
      })
      .catch(() => {})
  }, [rideId])

  // Rider added a stop / a stop was resolved (see rides.service.ts addRideStop,
  // markStopStatus). The push already fired, but it lands on the screen the driver
  // is on, so without this the stop list, map and OTP gate stay stale.
  const [stopNotice, setStopNotice] = useState<{ message: string; key: number } | null>(null)
  useEffect(() => {
    function onStopAdded(payload: { stop?: { address?: string | null } }) {
      const message = payload.stop?.address ? `Rider added a stop: ${payload.stop.address}` : 'Rider added a stop'
      setStopNotice((prev) => ({ message, key: (prev?.key ?? 0) + 1 }))
      refresh()
    }
    socket.on('stop:added', onStopAdded)
    socket.on('stop:updated', refresh)
    return () => {
      socket.off('stop:added', onStopAdded)
      socket.off('stop:updated', refresh)
    }
  }, [refresh])

  // Live end-of-ride from the other side. Socket.io doesn't replay missed events, so a
  // disconnect is covered by `load` re-running on rejoin (useRoomJoin below).
  useEffect(() => {
    function onStatusUpdate(payload: { status: string } & ExternalEndInfo) {
      const message = externalEndMessage(payload.status, payload)
      if (message) setEndedExternally(message)
    }
    socket.on('ride:status_update', onStatusUpdate)
    return () => { socket.off('ride:status_update', onStatusUpdate) }
  }, [])

  // A cold start mid-ride redirects straight here (app/index.tsx -> relaunchRoute),
  // so Home's session check -- the only other place that connects the socket --
  // never runs. Without this the driver gets no stop:added/stop:updated, chat, or
  // admin force-resolve events until they leave the screen. connect() is a no-op
  // when already connected; disconnecting stays with go-offline.
  useEffect(() => {
    connectSocket()
  }, [])

  // Re-joins ride:{rideId} on mount and on every socket reconnect, per the
  // shared room-join contract -- a bare reconnect doesn't replay whatever
  // changed while disconnected, so onRejoined re-fetches.
  useRoomJoin(socket, rideId, load)

  useEffect(() => {
    fetchUnreadChatCount(rideId).then(setUnreadChatCount).catch(() => {})
  }, [rideId])

  useEffect(() => {
    function onChatMessage(payload: { senderType: 'user' | 'driver' }) {
      if (payload.senderType === 'user') setUnreadChatCount((c) => c + 1)
    }
    socket.on('chat:message', onChatMessage)
    return () => { socket.off('chat:message', onChatMessage) }
  }, [])

  // Rider nudged their pickup pin after booking (bounded-radius correction --
  // see api/src/modules/rides/rides.service.ts's updateRidePickup). The push
  // notification (pickup_updated, routed by pushRouting.ts) already told the
  // driver this happened; this is what actually moves the nav target on the map.
  useEffect(() => {
    function onPickupUpdated(payload: { lat: number; lng: number; address: string | null }) {
      setRide((prev) => (prev ? { ...prev, originLat: payload.lat, originLng: payload.lng, originAddress: payload.address } : prev))
    }
    socket.on('ride:pickup_updated', onPickupUpdated)
    return () => { socket.off('ride:pickup_updated', onPickupUpdated) }
  }, [])

  const status = displayStatus(state)

  useEffect(() => {
    setActiveRideSummary({ id: rideId, status })
  }, [rideId, status, setActiveRideSummary])

  // Resolves true on success, false on failure: the slide-to-confirm control resets itself
  // on false, so a failed call never leaves it stuck on "Confirmed".
  const markArrivedAction = useCallback(async (): Promise<boolean> => {
    dispatch({ type: 'optimistic_advance', to: 'driver_arrived' })
    setActionError(null)
    try {
      await apiMarkArrived(rideId)
      dispatch({ type: 'confirmed', status: 'driver_arrived' })
      return true
    } catch {
      dispatch({ type: 'reverted' })
      setActionError('Could not confirm arrival. Try again.')
      return false
    }
  }, [rideId])

  // No optimistic advance: the OTP sheet stays open on "Verifying" until the server confirms,
  // so a wrong code never flashes the next screen. Resolves true only on success.
  const submitStartOtpAction = useCallback(
    async (otp: string): Promise<boolean> => {
      setActionError(null)
      try {
        await submitStartOtp(rideId, otp)
        dispatch({ type: 'confirmed', status: 'in_progress' })
        // started_at (and so bookedUntil for the trip clock) only exists now; the ride in hand predates it.
        refresh()
        return true
      } catch (err) {
        setActionError(isInvalidOtp(err) ? 'Incorrect OTP' : 'Could not confirm. Try again.')
        return false
      }
    },
    [rideId, refresh]
  )

  // No optimistic advance: the OTP sheet stays open on "Verifying" until the server confirms,
  // so a wrong code never flashes the next screen. Resolves true only on success.
  const submitEndOtpAction = useCallback(
    async (otp: string): Promise<boolean> => {
      setActionError(null)
      try {
        await submitEndOtp(rideId, otp)
        dispatch({ type: 'confirmed', status: 'completed' })
        // settled overtime (overtimeMin/overtimeFare) and the final fare exist only after settlement
        refresh()
        return true
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.data?.code === 'RIDE_HAS_PENDING_STOPS') {
          // The OTP was never checked -- a stop is still open. Refetch so the stop
          // card appears instead of leaving the driver guessing.
          setActionError('Finish or skip the pending stop first, then enter the OTP.')
          refresh()
        } else {
          setActionError(isInvalidOtp(err) ? 'Incorrect OTP' : 'Could not confirm. Try again.')
        }
        return false
      }
    },
    [rideId, refresh]
  )

  const startReturnAction = useCallback(async (): Promise<boolean> => {
    dispatch({ type: 'optimistic_advance', to: 'returning' })
    setActionError(null)
    try {
      await startReturn(rideId)
      dispatch({ type: 'confirmed', status: 'returning' })
      return true
    } catch {
      dispatch({ type: 'reverted' })
      setActionError('Could not start the return leg. Try again.')
      return false
    }
  }, [rideId])

  const arrivedAtDropAction = useCallback(async (): Promise<boolean> => {
    setActionError(null)
    try {
      await arrivedAtDrop(rideId)
      refresh()
      return true
    } catch {
      setActionError('Could not mark your arrival. Try again.')
      return false
    }
  }, [rideId, refresh])

  const collectCashAction = useCallback(
    async (input: { collectedAmount?: number; notCollected?: boolean; note?: string }) => {
      setActionError(null)
      try {
        const result = await submitCashCollection(rideId, input)
        // settleRideCompletionPayment (writes commission_amount/driver_earning)
        // runs async on the server, fired after this call already responded --
        // one re-fetch shortly after is enough to usually catch it landing
        // (web's TripEnd.tsx polls up to 5x for the same reason; the
        // completion screen falls back to an estimate if it's still missing).
        setTimeout(load, 1200)
        return result
      } catch {
        setActionError('Could not record cash collection. Try again.')
        return null
      }
    },
    [rideId, load]
  )

  // Left un-wrapped (throws instead of swallowing into actionError) -- CancelSheet's
  // own onConfirm contract expects a rejected promise to show its built-in
  // submitError/timeout states (packages/mobile-shared/src/ui/CancelSheet.tsx).
  const cancelRideAction = useCallback(
    async (reasonCode: string) => {
      await cancelRideAsDriver(rideId, reasonCode)
    },
    [rideId]
  )

  return {
    ride,
    loading,
    loadError,
    status,
    actionError,
    unreadChatCount,
    clearUnreadChatCount: () => setUnreadChatCount(0),
    reload: load,
    refresh,
    stopNotice,
    endedExternally,
    clearStopNotice: () => setStopNotice(null),
    markArrivedAction,
    submitStartOtpAction,
    submitEndOtpAction,
    collectCashAction,
    cancelRideAction,
    startReturnAction,
    arrivedAtDropAction,
  }
}
