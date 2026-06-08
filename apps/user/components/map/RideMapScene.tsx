'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import LocationPin from './LocationPin'
import CarMarker from './CarMarker'
import RoutePolyline from './RoutePolyline'

interface RideMapSceneProps {
  center: [number, number]
  pickupPos: [number, number]
  dropPos: [number, number]
  route: [number, number][]
  driverPos?: [number, number]
  driverHeading?: number
}

export default function RideMapScene({ center, pickupPos, dropPos, route, driverPos, driverHeading = 0 }: RideMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={13}>
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline positions={route} />
      {driverPos && <CarMarker position={driverPos} heading={driverHeading} />}
    </MapViewInner>
  )
}
