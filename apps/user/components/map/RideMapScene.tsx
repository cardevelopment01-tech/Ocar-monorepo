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
  /** Encoded polyline from routing API (real roads). Falls back to straight line. */
  encodedPolyline?: string
  driverPos?: [number, number]
  driverHeading?: number
}

export default function RideMapScene({
  center,
  pickupPos,
  dropPos,
  encodedPolyline,
  driverPos,
  driverHeading = 0,
}: RideMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={13}>
      {driverPos
        ? <RecenterMap center={driverPos} />
        : <FitBounds positions={[pickupPos, dropPos]} paddingBottom={40} />
      }
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline encoded={encodedPolyline} positions={[pickupPos, dropPos]} />
      {driverPos && <CarMarker position={driverPos} heading={driverHeading} />}
    </MapViewInner>
  )
}
