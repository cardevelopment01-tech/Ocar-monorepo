'use client'

import { Map } from '@vis.gl/react-google-maps'

const ODISHA_BOUNDS = { north: 23.0, south: 17.5, east: 88.5, west: 82.0 }

// Desaturate + slightly brighten the map so terrain colours don't dominate.
// Roads and labels remain sharp, only the green/brown terrain washes out.
// This avoids Cloud Console setup while giving a clean minimal look.
const MAP_FILTER = 'saturate(0.6) brightness(1.04) contrast(0.96)'

interface MapViewInnerProps {
  center: [number, number]
  zoom: number
  className?: string
  children?: React.ReactNode
}

export default function MapViewInner({ center, zoom, className, children }: MapViewInnerProps) {
  return (
    <div className={className ?? 'w-full h-full'} style={{ height: '100%', width: '100%', filter: MAP_FILTER }}>
      <Map
        defaultCenter={{ lat: center[0], lng: center[1] }}
        defaultZoom={zoom}
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
        gestureHandling="greedy"
        disableDefaultUI
        restriction={{ latLngBounds: ODISHA_BOUNDS, strictBounds: false }}
        style={{ height: '100%', width: '100%' }}
      >
        {children}
      </Map>
    </div>
  )
}
