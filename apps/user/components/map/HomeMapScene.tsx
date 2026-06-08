'use client'

import MapViewInner from '@/components/ui/MapViewInner'
import LocationPin from './LocationPin'
import CarMarker from './CarMarker'

interface NearbyDriver {
  id: string
  lat: number
  lng: number
  heading: number
}

interface HomeMapSceneProps {
  center: [number, number]
  pickupPos: [number, number]
  drivers: NearbyDriver[]
}

export default function HomeMapScene({ center, pickupPos, drivers }: HomeMapSceneProps) {
  return (
    <MapViewInner center={center} zoom={14}>
      <LocationPin position={pickupPos} variant="pickup" />
      {drivers.map(d => (
        <CarMarker key={d.id} position={[d.lat, d.lng]} heading={d.heading} />
      ))}
    </MapViewInner>
  )
}
