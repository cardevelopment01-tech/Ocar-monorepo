'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import BreadcrumbTrail from './BreadcrumbTrail'
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
  breadcrumb?: [number, number][]
  userPos?: [number, number]
  nearbyDrivers?: Array<{ driver_id: string; lat: number; lng: number }>
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
  breadcrumb,
  userPos,
  nearbyDrivers,
}: RideMapSceneProps) {
  const isRecap      = routeMode === 'recap'
  const isPickupLeg  = routeMode === 'driver-pickup'
  const isInProgress = routeMode === 'driver-dest'
  const isSearching  = routeMode === 'pickup-dest'

  return (
    <MapViewInner center={center} zoom={13}>
      {isRecap
        ? (showDrop && <FitBounds positions={[pickupPos, dropPos]} paddingBottom={40} />)
        : driverPos
          ? <RecenterMap center={driverPos} />
          : (showDrop && <FitBounds positions={[pickupPos, dropPos]} paddingBottom={40} />)
      }
      <LocationPin position={pickupPos} variant="pickup" />
      {isPickupLeg && userPos && <LocationPin position={userPos} variant="user" />}
      {showDrop && <LocationPin position={dropPos} variant="drop" />}
      {isInProgress && breadcrumb && <BreadcrumbTrail positions={breadcrumb} />}
      <RoutePolyline encoded={encodedPolyline} variant={isPickupLeg ? 'pickup-leg' : 'default'} />
      {driverPos && !isRecap && <CarMarker position={driverPos} heading={driverHeading} />}
      {isSearching && !driverPos && nearbyDrivers?.map(d => (
        <CarMarker key={d.driver_id} position={[d.lat, d.lng]} />
      ))}
    </MapViewInner>
  )
}
