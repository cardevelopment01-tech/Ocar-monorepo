import { Map } from '@vis.gl/react-google-maps'

const ODISHA_BOUNDS = { north: 23.0, south: 17.5, east: 88.5, west: 82.0 }

const MAP_FILTER = 'saturate(0.6) brightness(1.04) contrast(0.96)'

// One map style everywhere, one of exactly two camera modes:
//
//   OVERVIEW    pitch 0, heading north-up, zoom under manual/fit-bounds control.
//               Idle/GoOnline map, trip-request pickup preview, route-overview
//               beats, end-of-trip summary.
//   NAVIGATION  pitch 45, heading = driver bearing, zoom driven by
//               distanceToManeuver. Only NavigateToPickup / TripInProgress,
//               only once the "dive" transition has completed.
//
// A "mode" is just a documented preset of RecenterMap props — do not invent a
// third mode or a per-screen mapId override; every screen uses the same
// Cloud-styled mapId below so the map never visually "reboots" between screens.
interface DriverMapViewProps {
  initialCenter: [number, number]
  zoom?: number
  dimmed?: boolean
  /** Rarely needed — overrides the app-wide Cloud map style. Leave unset. */
  mapId?: string
  children?: React.ReactNode
}

export default function DriverMapView({ initialCenter, zoom = 15, dimmed = false, mapId, children }: DriverMapViewProps) {
  return (
    <div className="relative w-full h-full">
      <div style={{ width: '100%', height: '100%', filter: MAP_FILTER }}>
        <Map
          defaultCenter={{ lat: initialCenter[0], lng: initialCenter[1] }}
          defaultZoom={zoom}
          mapId={mapId || import.meta.env.VITE_GOOGLE_MAPS_DARK_MAP_ID || import.meta.env.VITE_GOOGLE_MAPS_ID}
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
