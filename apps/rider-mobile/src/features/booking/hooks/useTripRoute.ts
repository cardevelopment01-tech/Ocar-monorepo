import { useEffect, useState } from 'react'
import { fetchRoute } from '../api'
import type { BookingPlace } from '../store'

export type TripRoute = { km: number; min: number }

/**
 * Pickup -> stops -> drop, one routed leg after another, summed. The same lookup the rental screen makes (not
 * traffic-aware: package tiers are coarse). `null` while loading or when there is no pickup and drop yet.
 */
export function useTripRoute(pickup: BookingPlace | null, drop: BookingPlace | null, stops: BookingPlace[]): { trip: TripRoute | null; ready: boolean } {
  const [trip, setTrip] = useState<TripRoute | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!pickup || !drop) { setTrip(null); setReady(true); return }
    let cancelled = false
    setReady(false)
    const pts = [pickup, ...stops, drop]
    Promise.all(pts.slice(0, -1).map((p, i) => fetchRoute(p.lat, p.lng, pts[i + 1]!.lat, pts[i + 1]!.lng)))
      .then((legs) => {
        if (cancelled) return
        setTrip({
          km: Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 10) / 10,
          min: Math.round(legs.reduce((s, l) => s + l.durationMin, 0)),
        })
        setReady(true)
      })
      .catch(() => { if (!cancelled) { setTrip(null); setReady(true) } })
    return () => { cancelled = true }
  }, [pickup, drop, stops])
  return { trip, ready }
}
