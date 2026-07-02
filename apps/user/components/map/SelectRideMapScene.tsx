'use client'

import { useMemo } from 'react'
import MapViewInner from '@/components/ui/MapViewInner'
import FitBounds from './FitBounds'
import LocationPin from './LocationPin'
import CarMarker from './CarMarker'
import RoutePolyline from './RoutePolyline'
import { decodePolyline } from '@/lib/polyline'

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
  // Fit to the full route geometry so curved paths stay in frame, not just endpoints
  const boundsPositions = useMemo<[number, number][]>(() => {
    if (encodedPolyline) {
      const pts = decodePolyline(encodedPolyline)
      if (pts.length >= 2) return pts
    }
    return [pickupPos, dropPos]
  }, [encodedPolyline, pickupPos, dropPos])

  return (
    <MapViewInner center={center} zoom={13}>
      <FitBounds positions={boundsPositions} paddingBottom={80} />
      <LocationPin position={pickupPos} variant="pickup" />
      <LocationPin position={dropPos} variant="drop" />
      <RoutePolyline encoded={encodedPolyline} />
      {nearbyDrivers.map(d => (
        <CarMarker key={d.driver_id} position={[d.lat, d.lng]} />
      ))}
    </MapViewInner>
  )
}
