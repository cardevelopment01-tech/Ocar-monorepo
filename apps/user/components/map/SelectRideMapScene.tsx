'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import FitBounds from './FitBounds'
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
  /** Google encoded polyline from Directions API */
  encodedPolyline?: string
  nearbyDrivers?: NearbyDriver[]
}

export default function SelectRideMapScene({
  center,
  pickupPos,
  dropPos,
  encodedPolyline,
  nearbyDrivers = [],
}: SelectRideMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={13}>
      <FitBounds positions={[pickupPos, dropPos]} paddingBottom={8} />
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline encoded={encodedPolyline} />
      {nearbyDrivers.map(d => (
        <CarMarker key={d.driver_id} position={[d.lat, d.lng]} />
      ))}
    </MapViewInner>
  )
}
