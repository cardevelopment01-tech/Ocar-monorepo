'use client'

import { useMemo } from 'react'
import { Polyline } from 'react-leaflet'
import { decodePolyline } from '@/lib/polyline'

interface RoutePolylineProps {
  /** Google encoded polyline string (preferred — real road shape) */
  encoded?: string
  /** Fallback straight-line positions when no encoded polyline available */
  positions?: [number, number][]
}

export default function RoutePolyline({ encoded, positions }: RoutePolylineProps) {
  const pts = useMemo<[number, number][]>(() => {
    if (encoded) return decodePolyline(encoded)
    return positions ?? []
  }, [encoded, positions])

  if (pts.length < 2) return null

  return (
    <Polyline
      positions={pts}
      pathOptions={{ color: '#2563EB', weight: 4, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
    />
  )
}
