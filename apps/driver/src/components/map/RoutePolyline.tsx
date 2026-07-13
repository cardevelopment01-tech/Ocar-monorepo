import { useMemo } from 'react'
import { Polyline } from '@vis.gl/react-google-maps'
import { decodePolyline } from '@/lib/polyline'

const ARROW_ICON = {
  path: 'M -2,-3 2,0 -2,3',
  strokeColor: '#ffffff',
  strokeWeight: 2,
  strokeOpacity: 0.85,
  fillOpacity: 0,
  scale: 3,
}

interface RoutePolylineProps {
  encoded?: string
  positions?: [number, number][]
  variant?: 'default' | 'traveled-backdrop'
}

export default function RoutePolyline({ encoded, positions, variant = 'default' }: RoutePolylineProps) {
  const pts = useMemo<[number, number][]>(() => {
    if (encoded) return decodePolyline(encoded)
    // >=2 (not >=3): a trimmed remaining path can legitimately be just the
    // snapped point + the final route point near the end of a trip.
    if (positions && positions.length >= 2) return positions
    return []
  }, [encoded, positions])

  const path = useMemo(
    () => pts.map(([lat, lng]) => ({ lat, lng })),
    [pts]
  )

  if (pts.length < 2) return null

  // Static full-route backdrop (Phase 7b) — always the untrimmed route, rendered
  // once underneath the trimmed "remaining" line on top, so the traveled portion
  // reads as this dim line showing through rather than needing to be erased
  // (matches Mapbox's vanishing-route-line approach — no trim-seam flicker).
  if (variant === 'traveled-backdrop') {
    return (
      <Polyline
        path={path}
        strokeColor="#CBD5E1"
        strokeWeight={5}
        strokeOpacity={0.55}
        zIndex={0}
      />
    )
  }

  return (
    <>
      <Polyline
        path={path}
        strokeColor="#ffffff"
        strokeWeight={11}
        strokeOpacity={0.9}
        zIndex={1}
      />
      <Polyline
        path={path}
        strokeColor="#1A73E8"
        strokeWeight={7}
        strokeOpacity={1}
        zIndex={2}
      />
      {/* Arrow markers on their own invisible-stroke line, above TrafficColoredRoute's
          zIndex={3} — otherwise a congestion-tinted segment (drawn on top of the blue
          fill above) covers the arrows for that stretch, reading as a broken/half-
          rendered line (Phase 10d). */}
      <Polyline
        path={path}
        strokeOpacity={0}
        zIndex={4}
        icons={[{ icon: ARROW_ICON, repeat: '80px' }]}
      />
    </>
  )
}
