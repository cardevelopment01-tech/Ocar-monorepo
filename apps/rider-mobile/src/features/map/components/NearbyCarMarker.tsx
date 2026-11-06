import { memo, useEffect, useRef, useState } from 'react'
import { Marker, type MapMarker } from 'react-native-maps'
import { carStep } from '@/features/ride-tracking/nearbyCars'
import { VehicleGlyph } from './VehicleGlyph'
import type { VehicleKind } from '../vehicleKind'
import { useMarkerSettled } from './useMarkerSettled'

// One available car near the rider's pickup while a ride is being matched. Positions arrive about every 3 s (live push) or 8 s
// (polling fallback); instead of jumping, the marker glides to each new position over as long as it took that update to arrive,
// so the car is always moving and never waits for the next one. It turns the way the driver's phone reports (`heading`), or the
// way it just moved. The first position is the marker's own `coordinate`; later moves are native animations, so React does not
// re-render per frame and a moving car costs nothing between updates.
const FIRST_GLIDE_MS = 3000
const MIN_GLIDE_MS = 1000
const MAX_GLIDE_MS = 8000
const SNAPSHOT_MS = 700

/** `ready`: the map is ready, so the native marker exists and may animate (see useMarkerSettled). */
type Props = { position: [number, number]; ready: boolean; kind?: VehicleKind; heading?: number; opacity?: number }

function NearbyCarMarker({ position, ready, kind = 'sedan', heading: reported, opacity = 1 }: Props) {
  const ref = useRef<MapMarker>(null)
  const [start] = useState(position)
  const last = useRef(position)
  const lastAt = useRef(0)
  const [moved, setMoved] = useState(0)
  const [track, setTrack] = useState(true)
  const settled = useMarkerSettled(ready)

  useEffect(() => {
    const t = setTimeout(() => setTrack(false), SNAPSHOT_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!settled) return // the native marker may not exist yet: animating it now would crash the app
    const prev = last.current
    const step = carStep(prev, position)
    if (step.kind === 'stay') return
    last.current = position
    const to = { latitude: position[0], longitude: position[1] }
    const now = Date.now()
    const gap = lastAt.current === 0 ? FIRST_GLIDE_MS : now - lastAt.current
    lastAt.current = now
    if (step.kind === 'snap') {
      ref.current?.animateMarkerToCoordinate(to, 1)
      return
    }
    if (step.heading !== null) setMoved(step.heading)
    ref.current?.animateMarkerToCoordinate(to, Math.min(Math.max(gap, MIN_GLIDE_MS), MAX_GLIDE_MS))
  }, [position, settled])

  return (
    <Marker
      ref={ref}
      coordinate={{ latitude: start[0], longitude: start[1] }}
      anchor={{ x: 0.5, y: 0.5 }}
      rotation={reported ?? moved}
      flat
      tracksViewChanges={track}
      opacity={opacity}
      zIndex={5}
    >
      <VehicleGlyph kind={kind} />
    </Marker>
  )
}

export default memo(
  NearbyCarMarker,
  (a, b) => a.position[0] === b.position[0] && a.position[1] === b.position[1] && (a.opacity ?? 1) === (b.opacity ?? 1) && a.heading === b.heading && a.ready === b.ready && a.kind === b.kind,
)
