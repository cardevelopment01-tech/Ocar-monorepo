'use client'

import dynamic from 'next/dynamic'

const MapViewInner = dynamic(
  () => import('./MapViewInner'),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full h-full bg-background animate-pulse"
        style={{ minHeight: '300px' }}
      />
    ),
  }
)

interface MapViewProps {
  center?: [number, number]
  zoom?: number
  className?: string
  children?: React.ReactNode
}

export default function MapView({
  center = [20.2961, 85.8245],
  zoom = 16,
  className = '',
  children,
}: MapViewProps) {
  return (
    <MapViewInner
      center={center}
      zoom={zoom}
      className={className}
    >
      {children}
    </MapViewInner>
  )
}
