'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import FitBounds from './FitBounds'
import LocationPin from './LocationPin'
import CarMarker from './CarMarker'
import RoutePolyline from './RoutePolyline'
import StopPin from './StopPin'

interface NearbyDriver {
  driver_id: string
  lat: number
  lng: number
}

interface SelectRideMapSceneProps {
  center: [number, number]
  pickupPos: [number, number]
  dropPos: [number, number]
  /** Google encoded polyline from Directions API (origin→dest, no stops) */
  encodedPolyline?: string
  /** Numbered waypoints between pickup and drop */
  stops?: [number, number][]
  /** Per-leg encoded polylines routed through the stops — drawn instead of
   *  `encodedPolyline` so the detour is visible. */
  legPolylines?: string[]
  nearbyDrivers?: NearbyDriver[]
}

export default function SelectRideMapScene({
  center,
  pickupPos,
  dropPos,
  encodedPolyline,
  stops = [],
  legPolylines,
  nearbyDrivers = [],
}: SelectRideMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={13}>
      <FitBounds positions={[pickupPos, ...stops, dropPos]} paddingBottom={8} />
      <LocationPin position={pickupPos} variant="pickup" />
      {legPolylines && legPolylines.length > 0
        ? legPolylines.map((leg, i) => <RoutePolyline key={i} encoded={leg} />)
        : <RoutePolyline encoded={encodedPolyline} />}
      {stops.map((p, i) => <StopPin key={`${p[0]}-${p[1]}`} position={p} index={i + 1} />)}
      <LocationPin position={dropPos} variant="drop" />
      {nearbyDrivers.map(d => (
        <CarMarker key={d.driver_id} position={[d.lat, d.lng]} />
      ))}
    </MapViewInner>
  )
}
