'use client'

import { useState, useEffect } from 'react'
import Map from 'react-map-gl/maplibre'
import type { StyleSpecification } from 'maplibre-gl'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

// Odisha service area + generous buffer — prevents zoom-to-whole-earth
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

interface MapViewInnerProps {
  center: [number, number]
  zoom: number
  className?: string
  children?: React.ReactNode
}

export default function MapViewInner({ center, zoom, className, children }: MapViewInnerProps) {
  const [mapStyle, setMapStyle] = useState<StyleSpecification | string>(styleCache ?? STYLE_URL)

  useEffect(() => {
    if (styleCache) return
    getStyle().then(setMapStyle).catch(() => {})
  }, [])

  return (
    <div className={className ?? 'w-full h-full'} style={{ height: '100%', width: '100%' }}>
      <Map
        initialViewState={{ latitude: center[0], longitude: center[1], zoom }}
        mapStyle={mapStyle}
        style={{ height: '100%', width: '100%' }}
        minZoom={6}
        maxZoom={19}
        maxBounds={ODISHA_BOUNDS}
        reuseMaps
        pixelRatio={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1}
      >
        {children}
      </Map>
    </div>
  )
}
