import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { decodePolyline } from '@/lib/polyline'

interface RoutePolylineProps {
  encoded?: string
  positions?: [number, number][]
}

export default function RoutePolyline({ encoded, positions }: RoutePolylineProps) {
  const pts = useMemo<[number, number][]>(() => {
    if (encoded) return decodePolyline(encoded)
    return positions ?? []
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

  return (
    <Source id="route" type="geojson" data={geojson}>
      <Layer
        id="route-line"
        type="line"
        paint={{ 'line-color': '#2563EB', 'line-width': 4, 'line-opacity': 0.85 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
    </Source>
  )
}
