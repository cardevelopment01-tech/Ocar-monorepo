import { useEffect } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

// No @types/google.maps ambient declaration in this repo (see TrafficLayer.tsx)
// — read `google` off window rather than referencing the bare global by name.
type GoogleMapsNamespace = {
  maps: { LatLngBounds: new () => { extend: (p: { lat: number; lng: number }) => void } }
}
interface FitBoundsMap {
  fitBounds: (
    bounds: { extend: (p: { lat: number; lng: number }) => void },
    padding?: { top?: number; bottom?: number; left?: number; right?: number },
  ) => void
  setOptions: (options: { maxZoom: number | null }) => void
  addListener: (event: string, handler: () => void) => { remove: () => void }
}

interface FitBoundsToPointsProps {
  points: ([number, number] | null)[]
  padding?: { top?: number; bottom?: number; left?: number; right?: number }
}

// Same rationale as the user app's FitBounds.tsx (Phase 7a) — belt-and-suspenders
// here since the driver app's overview beat already self-corrects to
// zoomForDistance() within ~600ms, but keeps both apps' one-shot fit behaviour
// consistent.
const MAX_FIT_ZOOM = 17

/**
 * One-shot fit-bounds framing two or more points together — the "here's the
 * pickup" / "here's the job" overview beats shared by the trip-request
 * preview and the overview<->navigation dive (see
 * docs/DRIVER_TRIP_UX_REDESIGN_PLAN.md §1-4). Renders nothing; lives inside
 * DriverMapView's children so useMap() has map context. Callers that want a
 * one-shot fit followed by continuous following should stop rendering this
 * and render RecenterMap instead once they switch to NAVIGATION mode.
 */
export default function FitBoundsToPoints({ points, padding }: FitBoundsToPointsProps) {
  const map = useMap()
  const valid = points.filter((p): p is [number, number] => p !== null)
  const key = valid.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join('|')

  useEffect(() => {
    if (!map || valid.length < 2) return
    const g = (window as unknown as { google?: GoogleMapsNamespace }).google
    if (!g?.maps?.LatLngBounds) return
    const bounds = new g.maps.LatLngBounds()
    valid.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
    const m = map as unknown as FitBoundsMap
    m.setOptions({ maxZoom: MAX_FIT_ZOOM })
    m.fitBounds(bounds, padding)
    const listener = m.addListener('idle', () => {
      listener.remove()
      m.setOptions({ maxZoom: null })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])

  return null
}
