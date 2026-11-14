import { memo } from 'react'
import { Marker } from 'react-native-maps'
import { VEHICLE_IMAGES } from '../vehicleImages'
import type { VehicleKind } from '../vehicleKind'
import { MARKER_Z } from '../markerZ'

export type CarMarkerProps = {
  position: [number, number]
  heading?: number
  /** False until a real bearing has been derived from two GPS fixes -- renders
   *  at reduced opacity instead of a fake 0°/north snap (matches web's CarMarker). */
  headingKnown?: boolean
  /** Overrides the headingKnown-derived opacity -- for callers (e.g. an idle
   *  home screen) that want the marker to read as more solid without
   *  dishonestly claiming a real bearing via headingKnown. */
  opacity?: number
  /** Which vehicle is drawn (a sedan unless told otherwise): one top-down image per vehicle category. */
  kind?: VehicleKind
}

// The driver's own vehicle on the map. A ready-made image (see vehicleImages.ts), not a drawing: the map takes it as a native icon, so
// there is nothing to capture and no way to end up with a blank marker. react-native-maps rotates the whole Marker natively
// (rotation + flat), so the image, drawn facing up, needs no manual transform.
function CarMarker({ position, heading = 0, headingKnown = true, opacity, kind = 'sedan' }: CarMarkerProps) {
  return (
    <Marker
      coordinate={{ latitude: position[0], longitude: position[1] }}
      anchor={{ x: 0.5, y: 0.5 }}
      rotation={heading % 360}
      flat
      image={VEHICLE_IMAGES[kind]}
      opacity={opacity ?? (headingKnown ? 1 : 0.55)}
      zIndex={MARKER_Z.car}
    />
  )
}

export default memo(CarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  (a.heading ?? 0) === (b.heading ?? 0) &&
  (a.headingKnown ?? true) === (b.headingKnown ?? true) &&
  a.opacity === b.opacity &&
  (a.kind ?? 'sedan') === (b.kind ?? 'sedan')
)
