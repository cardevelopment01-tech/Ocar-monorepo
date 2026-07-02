'use client'

import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'

interface BreadcrumbTrailProps {
  positions: [number, number][]
}

export default function BreadcrumbTrail({ positions }: BreadcrumbTrailProps) {
  const geojson = useMemo(() => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: positions.map(([lat, lng]) => [lng, lat]),
    },
    properties: {},
  }), [positions])

  if (positions.length < 2) return null

  return (
    <Source id="breadcrumb" type="geojson" data={geojson}>
      <Layer
        id="breadcrumb-line"
        type="line"
        paint={{ 'line-color': '#94A3B8', 'line-width': 3, 'line-opacity': 0.55 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
    </Source>
  )
}
