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
  const keyPoints: [number, number][] = [pickupPos, dropPos]

  return (
    <MapViewInner center={center} zoom={13}>
      <FitBounds positions={keyPoints} paddingBottom={80} />
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline encoded={encodedPolyline} positions={keyPoints} />
      {nearbyDrivers.map(d => (
        <CarMarker key={d.driver_id} position={[d.lat, d.lng]} />
      ))}
    </MapViewInner>
  )
}
