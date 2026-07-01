'use client'

import { useMemo } from 'react'
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

  const fallbackPositions = useMemo<[number, number][]>(() => {
    if (routeMode === 'driver-pickup' && driverPos) return [driverPos, pickupPos]
    if (routeMode === 'driver-dest'   && driverPos) return [driverPos, dropPos]
    return [pickupPos, dropPos]
  }, [routeMode, driverPos, pickupPos, dropPos])

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
      <RoutePolyline encoded={encodedPolyline} positions={fallbackPositions} />
      {driverPos && !isRecap && <CarMarker position={driverPos} heading={driverHeading} />}
    </MapViewInner>
  )
}
