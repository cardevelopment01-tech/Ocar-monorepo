import { Map } from '@vis.gl/react-google-maps'

const ODISHA_BOUNDS = { north: 23.0, south: 17.5, east: 88.5, west: 82.0 }

const MAP_FILTER = 'saturate(0.6) brightness(1.04) contrast(0.96)'

interface DriverMapViewProps {
  initialCenter: [number, number]
  zoom?: number
  dimmed?: boolean
  children?: React.ReactNode
}

export default function DriverMapView({ initialCenter, zoom = 15, dimmed = false, children }: DriverMapViewProps) {
  return (
    <div className="relative w-full h-full">
      <div style={{ width: '100%', height: '100%', filter: MAP_FILTER }}>
        <Map
          defaultCenter={{ lat: initialCenter[0], lng: initialCenter[1] }}
          defaultZoom={zoom}
          mapId={import.meta.env.VITE_GOOGLE_MAPS_ID}
          gestureHandling="greedy"
          disableDefaultUI
          restriction={{ latLngBounds: ODISHA_BOUNDS, strictBounds: false }}
          style={{ width: '100%', height: '100%' }}
        >
          {children}
        </Map>
      </div>
      {dimmed && (
        <div className="absolute inset-0 bg-bg/40 pointer-events-none" style={{ zIndex: 1 }} />
      )}
    </div>
  )
}
