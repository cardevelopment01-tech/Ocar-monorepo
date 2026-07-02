import { useState, useEffect } from 'react'
import Map from 'react-map-gl/maplibre'
import type { StyleSpecification } from 'maplibre-gl'

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

const ODISHA_BOUNDS: [[number, number], [number, number]] = [[82.0, 17.5], [88.5, 23.0]]

let styleCache: StyleSpecification | null = null
let styleFetch: Promise<StyleSpecification> | null = null

function getStyle(): Promise<StyleSpecification> {
  if (styleCache) return Promise.resolve(styleCache)
  if (!styleFetch) {
    styleFetch = fetch(STYLE_URL)
      .then(r => r.json() as Promise<StyleSpecification>)
      .then(s => { styleCache = s; return s })
  }
  return styleFetch
}

interface DriverMapViewProps {
  initialCenter: [number, number]
  zoom?: number
  dimmed?: boolean
  children?: React.ReactNode
}

export default function DriverMapView({ initialCenter, zoom = 15, dimmed = false, children }: DriverMapViewProps) {
  const [mapStyle, setMapStyle] = useState<StyleSpecification | string>(styleCache ?? STYLE_URL)

  useEffect(() => {
    if (styleCache) return
    getStyle().then(setMapStyle).catch(() => {})
  }, [])

  return (
    <div className="relative w-full h-full">
      <Map
        initialViewState={{ latitude: initialCenter[0], longitude: initialCenter[1], zoom }}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        minZoom={6}
        maxZoom={19}
        maxBounds={ODISHA_BOUNDS}
        reuseMaps
        pixelRatio={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1}
      >
        {children}
      </Map>
      {dimmed && (
        <div className="absolute inset-0 bg-bg/40 pointer-events-none" style={{ zIndex: 1 }} />
      )}
    </div>
  )
}
