'use client'

import { useState, useEffect } from 'react'
import Map from 'react-map-gl/maplibre'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

// Cache the style JSON once per session — all map instances share it.
let styleCache: object | null = null
if (typeof window !== 'undefined') {
  fetch(STYLE_URL)
    .then(r => r.json() as Promise<object>)
    .then(s => { styleCache = s })
    .catch(() => {})
}

interface MapViewInnerProps {
  center: [number, number]
  zoom: number
  className?: string
  children?: React.ReactNode
}

export default function MapViewInner({ center, zoom, className, children }: MapViewInnerProps) {
  const [mapStyle, setMapStyle] = useState<object | string>(styleCache ?? STYLE_URL)

  useEffect(() => {
    if (styleCache) { setMapStyle(styleCache); return }
    fetch(STYLE_URL)
      .then(r => r.json() as Promise<object>)
      .then(s => { styleCache = s; setMapStyle(s) })
      .catch(() => {})
  }, [])

  return (
    <div className={className ?? 'w-full h-full'} style={{ height: '100%', width: '100%' }}>
      <Map
        initialViewState={{ latitude: center[0], longitude: center[1], zoom }}
        mapStyle={mapStyle}
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
        reuseMaps
      >
        {children}
      </Map>
    </div>
  )
}
