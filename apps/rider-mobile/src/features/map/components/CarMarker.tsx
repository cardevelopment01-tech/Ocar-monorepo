import { memo, useEffect, useState } from 'react'
import { Marker } from 'react-native-maps'
import { CarGlyph } from './CarGlyph'

export type CarMarkerProps = {
  position: [number, number]
  heading?: number
  /** False until a real bearing has been derived from two GPS fixes -- renders
   *  at reduced opacity instead of a fake 0°/north snap (matches web's CarMarker). */
  headingKnown?: boolean
}

// How long the marker's picture keeps being re-captured after it appears (see below).
const SNAPSHOT_MS = 700

// The assigned driver's car. react-native-maps rotates the whole Marker natively (rotation + flat), so no manual
// transform is needed -- flat:true keeps the car aligned to true bearing instead of the device's map heading.
//
// tracksViewChanges: the marker's child is an SVG that has usually not painted by the first render pass, and a marker
// frozen at that moment keeps a blank picture on some phones (the pickup/drop pins already avoid this the same way).
// So it is tracked just long enough to paint once, then frozen: moving or turning the marker is native and needs no
// re-capture, so there is no steady CPU/battery cost.
function CarMarker({ position, heading = 0, headingKnown = true }: CarMarkerProps) {
  const [track, setTrack] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setTrack(false), SNAPSHOT_MS)
    return () => clearTimeout(t)
  }, [])
  return (
    <Marker
      coordinate={{ latitude: position[0], longitude: position[1] }}
      anchor={{ x: 0.5, y: 0.5 }}
      rotation={heading % 360}
      flat
      tracksViewChanges={track}
      zIndex={10}
    >
      <CarGlyph dim={!headingKnown} />
    </Marker>
  )
}

export default memo(CarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  (a.heading ?? 0) === (b.heading ?? 0) &&
  (a.headingKnown ?? true) === (b.headingKnown ?? true)
)
