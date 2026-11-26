import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { captureError } from '@ocar/mobile-shared'
import { fetchReservations } from './api'
import type { Reservation } from './types'

const REFRESH_MS = 60_000

/**
 * The driver's reserved bookings, soonest first. Refreshes on mount, when the app returns to the foreground and every minute while mounted, so a booking
 * an admin reserves (or takes back) shows up without the driver doing anything. A failed refresh keeps what is on screen.
 * `now` ticks every 30 s so "in 24 min" and the phase move on their own.
 */
export function useReservations(): { reservations: Reservation[]; started: { rideId: string }[]; loading: boolean; error: boolean; now: number; refresh: () => Promise<void> } {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [started, setStarted] = useState<{ rideId: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const { reservations: list, started: began } = await fetchReservations()
      if (!alive.current) return
      setReservations(list)
      setStarted(began)
      setError(false)
    } catch (err) {
      if (!alive.current) return
      setError(true)
      captureError(err, { where: 'reservations_refresh' })
    } finally {
      if (alive.current) { setLoading(false); setNow(Date.now()) }
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    const poll = setInterval(() => { void refresh() }, REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh() })
    return () => { alive.current = false; clearInterval(poll); clearInterval(tick); sub.remove() }
  }, [refresh])

  return { reservations, started, loading, error, now, refresh }
}
