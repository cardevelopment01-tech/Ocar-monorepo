import { useEffect, useState } from 'react'
import * as Location from 'expo-location'

export type LatLng = { lat: number; lng: number }

/** Live GPS position and compass heading (degrees clockwise from north) for the rider's blue dot.
 *  Stays idle until `enabled` (permission granted) and tears both subscriptions down on unmount. */
export function useLiveLocation(enabled: boolean) {
  const [coords, setCoords] = useState<LatLng | null>(null)
  const [heading, setHeading] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let pos: Location.LocationSubscription | undefined
    let head: Location.LocationSubscription | undefined
    void (async () => {
      try {
        const p = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 3000 },
          (l) => setCoords({ lat: l.coords.latitude, lng: l.coords.longitude })
        )
        const hd = await Location.watchHeadingAsync((h) => {
          const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
          // ignore compass jitter under 5 degrees so the marker doesn't re-render on every sensor tick
          setHeading((prev) => (Math.abs(((v - prev + 540) % 360) - 180) > 5 ? v : prev))
        })
        if (cancelled) {
          p.remove()
          hd.remove()
        } else {
          pos = p
          head = hd
        }
      } catch {
        // no fix / sensor: the dot simply stays where the last known position put it
      }
    })()
    return () => {
      cancelled = true
      pos?.remove()
      head?.remove()
    }
  }, [enabled])

  return { coords, heading }
}
