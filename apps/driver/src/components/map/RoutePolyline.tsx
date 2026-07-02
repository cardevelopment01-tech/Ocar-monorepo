import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { decodePolyline } from '@/lib/polyline'

interface RoutePolylineProps {
  encoded?: string
  /** Pre-decoded coords — only rendered if ≥ 3 points (actual route, not a 2-point straight line). */
  positions?: [number, number][]
  /** 'pickup-leg' = dashed gray style (driver→pickup); 'default' = solid blue (trip route). */
  variant?: 'default' | 'pickup-leg'
}

export default function RoutePolyline({ encoded, positions, variant = 'default' }: RoutePolylineProps) {
  const pts = useMemo<[number, number][]>(() => {
    if (encoded) return decodePolyline(encoded)
    if (positions && positions.length >= 3) return positions
    return []
  }, [encoded, positions])

  const geojson = useMemo(() => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: pts.map(([lat, lng]) => [lng, lat]),
    },
    properties: {},
  }), [pts])

  if (pts.length < 2) return null

  const isPickup = variant === 'pickup-leg'

  return (
    <Source id="route" type="geojson" data={geojson}>
      {/* White casing underneath for road contrast */}
      <Layer
        id="route-casing"
        type="line"
        paint={{ 'line-color': '#ffffff', 'line-width': isPickup ? 6 : 8, 'line-opacity': 0.75 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
      {/* Main route line */}
      {isPickup ? (
        <Layer
          id="route-line"
          type="line"
          paint={{ 'line-color': '#64748B', 'line-width': 3.5, 'line-opacity': 0.8, 'line-dasharray': [6, 5] }}
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
        />
      ) : (
        <Layer
          id="route-line"
          type="line"
          paint={{ 'line-color': '#2563EB', 'line-width': 4.5, 'line-opacity': 0.92 }}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        />
      )}
    </Source>
  )
}
