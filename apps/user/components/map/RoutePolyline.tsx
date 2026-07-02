'use client'

import { useMemo, useEffect } from 'react'
import { Source, Layer, useMap } from 'react-map-gl/maplibre'
import { decodePolyline } from '@/lib/polyline'

const ARROW_ID = 'route-arrow'

function drawArrowImage(map: ReturnType<typeof useMap>['current']) {
  if (!map) return
  const canvas = document.createElement('canvas')
  canvas.width  = 20
  canvas.height = 20
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = 'rgba(255,255,255,0.88)'
  ctx.lineWidth   = 2.5
  ctx.lineCap     = 'round'
  ctx.lineJoin    = 'round'
  ctx.beginPath()
  ctx.moveTo(4, 10); ctx.lineTo(16, 10)
  ctx.moveTo(10, 4); ctx.lineTo(16, 10); ctx.lineTo(10, 16)
  ctx.stroke()
  try {
    if (map.hasImage(ARROW_ID)) map.removeImage(ARROW_ID)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addImage(ARROW_ID, canvas as any)
  } catch {
    // style rebuilt mid-flight; the next style.load will retry
  }
}

interface RoutePolylineProps {
  encoded?: string
  /** Pre-decoded coords — only rendered if ≥ 3 points (actual route, not a 2-point straight line). */
  positions?: [number, number][]
  /** 'pickup-leg' = dashed gray style (driver→pickup); 'default' = solid blue (trip route). */
  variant?: 'default' | 'pickup-leg'
}

export default function RoutePolyline({ encoded, positions, variant = 'default' }: RoutePolylineProps) {
  const { current: map } = useMap()

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

  // Register the directional arrow icon on the map sprite (default variant only).
  // Re-register on every style.load because MapLibre clears custom images on style rebuild.
  useEffect(() => {
    if (!map || variant === 'pickup-leg') return
    const register = () => drawArrowImage(map)
    if (map.isStyleLoaded()) register()
    else map.once('style.load', register)
    map.on('style.load', register)
    return () => { map.off('style.load', register) }
  }, [map, variant])

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
      {/* Directional arrows along the route (default variant only) */}
      {!isPickup && (
        <Layer
          id="route-arrows"
          type="symbol"
          layout={{
            'symbol-placement': 'line',
            'symbol-spacing': 100,
            'icon-image': ARROW_ID,
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
        />
      )}
    </Source>
  )
}
