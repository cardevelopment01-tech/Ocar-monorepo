'use client'

import { Polyline } from 'react-leaflet'

interface RoutePolylineProps {
  positions: [number, number][]
}

export default function RoutePolyline({ positions }: RoutePolylineProps) {
  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: '#2563EB', weight: 4, opacity: 0.8 }}
    />
  )
}
