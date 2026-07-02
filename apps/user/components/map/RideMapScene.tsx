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
  encodedPolyline?: string
  driverPos?: [number, number]
  driverHeading?: number
  routeMode: 'pickup-dest' | 'driver-pickup' | 'driver-dest' | 'recap'
  showDrop?: boolean
}

export default function RideMapScene({
  center,
  pickupPos,
  dropPos,
  encodedPolyline,
  driverPos,
  driverHeading = 0,
  routeMode,
  showDrop = true,
}: RideMapSceneProps) {
  const isRecap = routeMode === 'recap'

  const isPickupLeg = routeMode === 'driver-pickup'

  return (
    <MapViewInner center={center} zoom={13}>
      {isRecap
        ? (showDrop && <FitBounds positions={[pickupPos, dropPos]} paddingBottom={40} />)
        : driverPos
          ? <RecenterMap center={driverPos} />
          : (showDrop && <FitBounds positions={[pickupPos, dropPos]} paddingBottom={40} />)
      }
      <LocationPin position={pickupPos} variant="pickup" />
      {showDrop && <LocationPin position={dropPos} variant="drop" />}
      <RoutePolyline encoded={encodedPolyline} variant={isPickupLeg ? 'pickup-leg' : 'default'} />
      {driverPos && !isRecap && <CarMarker position={driverPos} heading={driverHeading} />}
    </MapViewInner>
  )
}
