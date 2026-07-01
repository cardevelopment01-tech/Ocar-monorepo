import { useState, useEffect } from 'react'
import Map from 'react-map-gl/maplibre'
import type { StyleSpecification } from 'maplibre-gl'

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

let styleCache: StyleSpecification | null = null
if (typeof window !== 'undefined') {
  fetch(STYLE_URL)
    .then(r => r.json() as Promise<StyleSpecification>)
    .then(s => { styleCache = s })
    .catch(() => {})
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
    if (styleCache) { setMapStyle(styleCache); return }
    fetch(STYLE_URL)
      .then(r => r.json() as Promise<StyleSpecification>)
      .then(s => { styleCache = s; setMapStyle(s) })
      .catch(() => {})
  }, [])

  return (
    <div className="relative w-full h-full">
      <Map
        initialViewState={{ latitude: initialCenter[0], longitude: initialCenter[1], zoom }}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        reuseMaps
        pixelRatio={typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1}
      >
        {children}
      </Map>
      {dimmed && (
        <div className="absolute inset-0 bg-bg/40 pointer-events-none" style={{ zIndex: 1 }} />
      )}
    </div>
  )
}
