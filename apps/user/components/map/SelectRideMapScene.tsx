'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import LocationPin from './LocationPin'
import CarMarker from './CarMarker'
import RoutePolyline from './RoutePolyline'

interface NearbyDriver {
  driver_id: string
  lat: number
  lng: number
}

interface SelectRideMapSceneProps {
  center: [number, number]
  pickupPos: [number, number]
  dropPos: [number, number]
  route: [number, number][]
  nearbyDrivers?: NearbyDriver[]
}

export default function SelectRideMapScene({ center, pickupPos, dropPos, route, nearbyDrivers = [] }: SelectRideMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={13}>
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline positions={route} />
      {nearbyDrivers.map(d => (
        <CarMarker key={d.driver_id} position={[d.lat, d.lng]} />
      ))}
    </MapViewInner>
  )
}
