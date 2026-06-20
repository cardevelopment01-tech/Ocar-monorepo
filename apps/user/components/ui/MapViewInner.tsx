'use client'

import Map from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

interface MapViewInnerProps {
  center: [number, number]
  zoom: number
  className?: string
  children?: React.ReactNode
}

export default function MapViewInner({ center, zoom, className, children }: MapViewInnerProps) {
  return (
    <div className={className ?? 'w-full h-full'} style={{ height: '100%', width: '100%' }}>
      <Map
        initialViewState={{ latitude: center[0], longitude: center[1], zoom }}
        mapStyle={MAP_STYLE}
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
      >
        {children}
      </Map>
    </div>
  )
}
