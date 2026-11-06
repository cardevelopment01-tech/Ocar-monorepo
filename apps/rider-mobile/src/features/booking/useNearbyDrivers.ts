import { useEffect, useState } from 'react'
import { useIsFocused } from 'expo-router'
import { fetchNearbyDrivers } from './api'

export type NearbyDriver = { driverId: string; lat: number; lng: number; categoryId: number }

const POLL_MS = 8000

/**
 * The available cars around a point, refreshed every 8 s while `enabled` and the screen is in front (same feed and cadence
 * as the fare screen). Empty when disabled. A failed poll keeps the cars already shown: this is a reassurance layer, not
 * booking data, so it must never throw into the screen or blank the map.
 */
export function useNearbyDrivers(lat: number | null, lng: number | null, enabled: boolean): NearbyDriver[] {
  const [drivers, setDrivers] = useState<NearbyDriver[]>([])
  const focused = useIsFocused()

  useEffect(() => {
    if (!enabled || !focused || lat === null || lng === null) return
    let cancelled = false
    async function poll() {
      try {
        const next = await fetchNearbyDrivers(lat as number, lng as number)
        if (!cancelled) setDrivers(next)
      } catch {
        // keep the last list
      }
    }
    void poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled, focused, lat, lng])

  // Searching ended (a driver was assigned, the ride was cancelled): clear the cars so they do not linger or reappear.
  useEffect(() => {
    if (!enabled) setDrivers([])
  }, [enabled])

  return drivers
}
