'use client'

import { useMemo } from 'react'
import { Polyline } from '@vis.gl/react-google-maps'
import { decodePolyline } from '@/lib/polyline'

// SVG chevron path — no dependency on google.maps global at render time
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
  variant?: 'default' | 'pickup-leg'
}

export default function RoutePolyline({ encoded, positions, variant = 'default' }: RoutePolylineProps) {
  const pts = useMemo<[number, number][]>(() => {
    if (encoded) return decodePolyline(encoded)
    if (positions && positions.length >= 3) return positions
    return []
  }, [encoded, positions])

  const path = useMemo(
    () => pts.map(([lat, lng]) => ({ lat, lng })),
    [pts]
  )

  if (pts.length < 2) return null

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

  return (
    <>
      <Polyline
        path={path}
        strokeColor="#ffffff"
        strokeWeight={8}
        strokeOpacity={0.75}
        zIndex={1}
      />
      <Polyline
        path={path}
        strokeColor="#2563EB"
        strokeWeight={4.5}
        strokeOpacity={0.92}
        zIndex={2}
        icons={[{ icon: ARROW_ICON, repeat: '80px' }]}
      />
    </>
  )
}
