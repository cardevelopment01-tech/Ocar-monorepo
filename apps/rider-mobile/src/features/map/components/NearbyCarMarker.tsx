import { memo, useEffect, useRef, useState } from 'react'
import { Marker, type MapMarker } from 'react-native-maps'
import { carStep } from '@/features/ride-tracking/nearbyCars'
import { CarGlyph } from './CarGlyph'

// One available car near the rider's pickup while a ride is being matched. The server reports positions every poll
// (~8 s); instead of jumping, the marker glides to each new position over a little less than that, and turns the way it
// is moving. The first position is the marker's own `coordinate`; later moves are native animations, so React does not
// re-render per frame and a moving car costs nothing between polls.
const GLIDE_MS = 6000
const SNAPSHOT_MS = 700

type Props = { position: [number, number] }

function NearbyCarMarker({ position }: Props) {
  const ref = useRef<MapMarker>(null)
  const [start] = useState(position)
  const last = useRef(position)
  const [heading, setHeading] = useState(0)
  const [track, setTrack] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setTrack(false), SNAPSHOT_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const prev = last.current
    const step = carStep(prev, position)
    if (step.kind === 'stay') return
    last.current = position
    const to = { latitude: position[0], longitude: position[1] }
    if (step.kind === 'snap') {
      ref.current?.animateMarkerToCoordinate(to, 1)
      return
    }
    if (step.heading !== null) setHeading(step.heading)
    ref.current?.animateMarkerToCoordinate(to, GLIDE_MS)
  }, [position])

  return (
    <Marker
      ref={ref}
      coordinate={{ latitude: start[0], longitude: start[1] }}
      anchor={{ x: 0.5, y: 0.5 }}
      rotation={heading}
      flat
      tracksViewChanges={track}
      zIndex={5}
    >
      <CarGlyph />
    </Marker>
  )
}

export default memo(NearbyCarMarker, (a, b) => a.position[0] === b.position[0] && a.position[1] === b.position[1])
