'use client'

import { useMemo } from 'react'
import { Polyline } from '@vis.gl/react-google-maps'
import { decodePolyline } from '@/lib/polyline'

// SVG chevron path, no dependency on google.maps global at render time
const ARROW_ICON = {
  path: 'M -2,-3 2,0 -2,3',
  strokeColor: '#ffffff',
  strokeWeight: 2,
  strokeOpacity: 0.85,
  fillOpacity: 0,
  scale: 3,
}

const DASH_ICON = {
  path: 'M 0,-1 0,1',
  strokeOpacity: 0.8,
  strokeColor: '#64748B',
  scale: 4,
}

interface RoutePolylineProps {
  encoded?: string
  positions?: [number, number][]
  variant?: 'default' | 'pickup-leg' | 'traveled-backdrop'
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
  // (avoids any trim-seam flicker; matches Mapbox's own vanishing-route-line approach).
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

  if (variant === 'pickup-leg') {
    return (
      <>
        <Polyline
          path={path}
          strokeColor="#ffffff"
          strokeWeight={6}
          strokeOpacity={0.6}
          zIndex={1}
        />
        <Polyline
          path={path}
          strokeColor="#64748B"
          strokeWeight={0}
          strokeOpacity={0}
          zIndex={2}
          icons={[{ icon: DASH_ICON, offset: '0', repeat: '16px' }]}
        />
      </>
    )
  }

  // Matches apps/driver/src/components/map/RoutePolyline.tsx's default variant —
  // same route on both apps should look like the same route (Customer#1, see
  // docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 4).
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
        icons={[{ icon: ARROW_ICON, repeat: '80px' }]}
      />
    </>
  )
}
