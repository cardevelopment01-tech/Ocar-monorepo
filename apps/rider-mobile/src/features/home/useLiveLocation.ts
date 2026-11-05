import { useEffect, useState } from 'react'
import * as Location from 'expo-location'
import { useFreshness, useLocationStore, useLocationTracking } from '@/store/useLocationStore'

export type LatLng = { lat: number; lng: number }

/** Live position and compass heading (degrees clockwise from north) for the rider's blue dot.
 *  The position is the location store's own fix (one GPS watcher for the whole app), shown only while it is live: a
 *  saved or minute-old fix would draw a real-looking blue dot at a stale spot. Only the compass is subscribed here. */
export function useLiveLocation(enabled: boolean, opts: { heading?: boolean } = {}) {
  const wantHeading = opts.heading ?? true
  useLocationTracking(enabled) // the watcher runs only while a screen that shows the dot is on show
  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)
  const live = useFreshness() === 'live'
  const coords: LatLng | null = enabled && live && lat !== null && lng !== null ? { lat, lng } : null
  const [heading, setHeading] = useState(0)

  useEffect(() => {
    if (!enabled || !wantHeading) return
    let cancelled = false
    let head: Location.LocationSubscription | undefined
    void (async () => {
      try {
        const hd = await Location.watchHeadingAsync((h) => {
          const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
          // ignore compass jitter under 5 degrees so the marker doesn't re-render on every sensor tick
          setHeading((prev) => (Math.abs(((v - prev + 540) % 360) - 180) > 5 ? v : prev))
        })
        if (cancelled) hd.remove()
        else head = hd
      } catch {
        // no compass sensor: the dot just keeps its last heading
      }
    })()
    return () => {
      cancelled = true
      head?.remove()
    }
  }, [enabled, wantHeading])

  return { coords, heading }
}
