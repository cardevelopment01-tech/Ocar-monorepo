'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import FitBounds from './FitBounds'
import RecenterMap from './RecenterMap'
import LocationPin from './LocationPin'
import CarMarker from './CarMarker'
import RoutePolyline from './RoutePolyline'

interface RideMapSceneProps {
  center: [number, number]
  pickupPos: [number, number]
  dropPos: [number, number]
  /** Straight-line route fallback (driver→pickup, driver→drop, etc.) */
  route: [number, number][]
  driverPos?: [number, number]
  driverHeading?: number
}

export default function RideMapScene({
  center,
  pickupPos,
  dropPos,
  route,
  driverPos,
  driverHeading = 0,
}: RideMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={13}>
      {driverPos
        // Driver is live — follow the car
        ? <RecenterMap center={driverPos} />
        // No driver yet — fit the whole pickup→drop route
        : <FitBounds positions={[pickupPos, dropPos]} />
      }
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline positions={route} />
      {driverPos && <CarMarker position={driverPos} heading={driverHeading} />}
    </MapViewInner>
  )
}
