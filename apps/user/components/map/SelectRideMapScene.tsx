'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import LocationPin from './LocationPin'
import RoutePolyline from './RoutePolyline'

interface SelectRideMapSceneProps {
  center: [number, number]
  pickupPos: [number, number]
  dropPos: [number, number]
  route: [number, number][]
}

export default function SelectRideMapScene({ center, pickupPos, dropPos, route }: SelectRideMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={13}>
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline positions={route} />
    </MapViewInner>
  )
}
