import { memo, useEffect, useRef, useState } from 'react'
import { Marker, type MapMarker } from 'react-native-maps'
import { carStep } from '@/features/ride-tracking/nearbyCars'
import { CarGlyph } from './CarGlyph'
import { useMarkerSettled } from './useMarkerSettled'

export type CarMarkerProps = {
  position: [number, number]
  heading?: number
  /** False until a real bearing has been derived from two GPS fixes -- renders
   *  at reduced opacity instead of a fake 0°/north snap (matches web's CarMarker). */
  headingKnown?: boolean
  /** True once `position` is a real driver fix. Before that the car is only a stand-in (parked at the pickup), and the
   *  first real fix must snap there: gliding would look like a car driving out of the pickup pin. */
  animate?: boolean
  /** Pass it (the map is ready) to let the car GLIDE between positions; leave it out and the car simply moves with `position`
   *  (the fare screen's cars). Gliding waits until the native marker exists (see useMarkerSettled). */
  ready?: boolean
}

// How long the marker's picture keeps being re-captured after it appears (see below).
const SNAPSHOT_MS = 700
// The driver's position arrives about every 3 s; gliding a little under that keeps the car moving continuously.
const GLIDE_MS = 2600

// The assigned driver's car. react-native-maps rotates the whole Marker natively (rotation + flat), so no manual
// transform is needed -- flat:true keeps the car aligned to true bearing instead of the device's map heading.
//
// Movement: the first position is the marker's own `coordinate`; later positions are native glides (`animateMarkerToCoordinate`),
// so the car moves smoothly between pings without re-rendering per frame. A jump that is not driving (a stale fix, the
// first real fix after the stand-in) snaps instead.
//
// tracksViewChanges: the marker's child is an SVG that has usually not painted by the first render pass, and a marker
// frozen at that moment keeps a blank picture on some phones (the pickup/drop pins already avoid this the same way).
// So it is tracked just long enough to paint once, then frozen: moving or turning the marker is native and needs no
// re-capture, so there is no steady CPU/battery cost.
function CarMarker({ position, heading = 0, headingKnown = true, animate = true, ready }: CarMarkerProps) {
  const glide = ready !== undefined
  const settled = useMarkerSettled(ready === true)
  const ref = useRef<MapMarker>(null)
  const [start] = useState(position)
  const last = useRef(position)
  const primed = useRef(animate)
  const [track, setTrack] = useState(true)

  // The marker's picture is frozen after SNAPSHOT_MS, so anything the picture shows must re-open the window when it changes:
  // the car starts dimmed (no heading yet) and turns solid -- without this it stayed washed-out grey for the whole trip.
  useEffect(() => {
    setTrack(true)
    const t = setTimeout(() => setTrack(false), SNAPSHOT_MS)
    return () => clearTimeout(t)
  }, [headingKnown])

  useEffect(() => {
    if (!glide || !settled) return // not gliding, or the native marker may not exist yet: animating it now would crash the app
    const step = carStep(last.current, position)
    if (step.kind === 'stay') return
    last.current = position
    const to = { latitude: position[0], longitude: position[1] }
    if (!animate) {
      primed.current = false
      ref.current?.animateMarkerToCoordinate(to, 1)
      return
    }
    if (!primed.current || step.kind === 'snap') {
      primed.current = true
      ref.current?.animateMarkerToCoordinate(to, 1)
      return
    }
    ref.current?.animateMarkerToCoordinate(to, GLIDE_MS)
  }, [position, animate, glide, settled])

  return (
    <Marker
      ref={ref}
      coordinate={glide ? { latitude: start[0], longitude: start[1] } : { latitude: position[0], longitude: position[1] }}
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
  (a.headingKnown ?? true) === (b.headingKnown ?? true) &&
  (a.animate ?? true) === (b.animate ?? true) &&
  a.ready === b.ready
)
