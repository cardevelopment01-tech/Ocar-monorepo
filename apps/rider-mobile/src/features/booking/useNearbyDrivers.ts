import { useEffect, useState } from 'react'
import { useIsFocused } from 'expo-router'
import { socket } from '@/services/socket'
import type { NearbyCar } from '@/features/ride-tracking/nearbyCars'
import { fetchNearbyDrivers } from './api'
import { attachNearbyCars } from './nearbySocket'
import { applyLive, applySnapshot, carsNear, expireCars, liveIsFlowing, sameCars, type LiveCars } from './liveCars'

export type { NearbyCar }

/** With live positions arriving, the REST snapshot is only a safety net. Without them it IS the feed, so it keeps its old pace. */
const SNAPSHOT_MS_LIVE = 30_000
const SNAPSHOT_MS_POLLING = 8_000
/** The list the map draws is rebuilt this often: one render for a burst of pings, not one per ping. */
const FLUSH_MS = 600

/**
 * The available cars around a searching ride's pickup, moving in real time.
 *
 * Live positions come over the socket (`nearby:car`, see attachNearbyCars); a REST snapshot fills the map the moment the screen
 * opens and takes over if the push is not reaching the phone. Empty when disabled. A failed fetch keeps the cars already shown:
 * this is a reassurance layer, not booking data, so it must never throw into the screen or blank the map.
 */
export function useNearbyDrivers(rideId: string | null, lat: number | null, lng: number | null, enabled: boolean): NearbyCar[] {
  const [cars, setCars] = useState<NearbyCar[]>([])
  const focused = useIsFocused()

  useEffect(() => {
    if (!enabled || !focused || rideId === null || lat === null || lng === null) return
    const pickup: [number, number] = [lat, lng]
    let known: LiveCars = new Map()
    let cancelled = false
    let shown: NearbyCar[] = []
    let timer: ReturnType<typeof setTimeout> | undefined

    const detach = attachNearbyCars(socket, rideId, (ev) => { known = applyLive(known, ev, Date.now()) })

    const fetchSnapshot = async () => {
      try {
        const snapshot = await fetchNearbyDrivers(lat, lng)
        if (!cancelled) known = applySnapshot(known, snapshot, Date.now())
      } catch {
        // keep what we have
      }
      if (cancelled) return
      timer = setTimeout(() => void fetchSnapshot(), liveIsFlowing(known, Date.now()) ? SNAPSHOT_MS_LIVE : SNAPSHOT_MS_POLLING)
    }
    void fetchSnapshot()

    const flush = setInterval(() => {
      known = expireCars(known, Date.now())
      const next = carsNear(known, pickup)
      if (!sameCars(shown, next)) {
        shown = next
        setCars(next)
      }
    }, FLUSH_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      clearInterval(flush)
      detach()
    }
  }, [enabled, focused, rideId, lat, lng])

  // Searching ended (a driver was assigned, the ride was cancelled): clear the cars so they do not linger or reappear.
  useEffect(() => {
    if (!enabled) setCars([])
  }, [enabled])

  return cars
}
