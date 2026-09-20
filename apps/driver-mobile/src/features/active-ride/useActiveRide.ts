import { useCallback, useEffect, useReducer, useState } from 'react'
import axios from 'axios'
import { useRoomJoin, type RideDetail } from '@ocar/mobile-shared'
import { socket } from '@/services/socket'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { fetchRide, markArrived as apiMarkArrived, submitCashCollection, submitEndOtp, submitStartOtp } from './api'
import { activeRideReducer, displayStatus, type RideStatus } from './reducer'

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
  const [state, dispatch] = useReducer(activeRideReducer, {
    confirmedStatus: 'accepted',
    pendingOptimisticStatus: null,
    rideType: '',
  })
  const setActiveRideSummary = useDriverSessionStore((s) => s.setActiveRide)

  const load = useCallback(() => {
    setLoading(true)
    fetchRide(rideId)
      .then((detail) => {
        setRide(detail as RideDetailSettled)
        dispatch({ type: 'confirmed', status: detail.status as RideStatus, rideType: detail.rideType })
        setLoadError(false)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [rideId])

  useEffect(() => {
    load()
  }, [load])

  // Re-joins ride:{rideId} on mount and on every socket reconnect, per the
  // shared room-join contract -- a bare reconnect doesn't replay whatever
  // changed while disconnected, so onRejoined re-fetches.
  useRoomJoin(socket, rideId, load)

  const status = displayStatus(state)

  useEffect(() => {
    setActiveRideSummary({ id: rideId, status })
  }, [rideId, status, setActiveRideSummary])

  const markArrivedAction = useCallback(async () => {
    dispatch({ type: 'optimistic_advance', to: 'driver_arrived' })
    setActionError(null)
    try {
      await apiMarkArrived(rideId)
      dispatch({ type: 'confirmed', status: 'driver_arrived' })
    } catch {
      dispatch({ type: 'reverted' })
      setActionError('Could not confirm arrival. Try again.')
    }
  }, [rideId])

  const submitStartOtpAction = useCallback(
    async (otp: string) => {
      dispatch({ type: 'optimistic_advance', to: 'in_progress' })
      setActionError(null)
      try {
        await submitStartOtp(rideId, otp)
        dispatch({ type: 'confirmed', status: 'in_progress' })
      } catch (err) {
        dispatch({ type: 'reverted' })
        setActionError(isInvalidOtp(err) ? 'Incorrect OTP' : 'Could not confirm. Try again.')
      }
    },
    [rideId]
  )

  const submitEndOtpAction = useCallback(
    async (otp: string) => {
      dispatch({ type: 'optimistic_advance', to: 'completed' })
      setActionError(null)
      try {
        await submitEndOtp(rideId, otp)
        dispatch({ type: 'confirmed', status: 'completed' })
      } catch (err) {
        dispatch({ type: 'reverted' })
        setActionError(isInvalidOtp(err) ? 'Incorrect OTP' : 'Could not confirm. Try again.')
      }
    },
    [rideId]
  )

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

  return {
    ride,
    loading,
    loadError,
    status,
    actionError,
    reload: load,
    markArrivedAction,
    submitStartOtpAction,
    submitEndOtpAction,
    collectCashAction,
  }
}
