import { useMemo } from 'react'
import { useDriverPositionStore } from '@/services/location/driverPositionStore'

export type DriverLivePosition = {
  position: [number, number]
  heading: number
  /** False until the device reports a real GPS heading (Android returns 0,
   *  iOS returns a negative value, when heading isn't known yet) -- avoids a
   *  fake north-snap on the car marker, matching web's CarMarker convention. */
  headingKnown: boolean
} | null

// The driver's own live position for the map marker. This used to start its own
// High-accuracy watchPositionAsync (and three screens each mounted one, on top of the
// background task). Now there is ONE stream: the background task's, tuned per ride state
// in backgroundTask.ts, which fills useDriverPositionStore. This hook just reads it.
export function useDriverLivePosition(active: boolean): DriverLivePosition {
  const position = useDriverPositionStore((s) => s.position)
  return useMemo(() => {
    if (!active || !position) return null
    const heading = position.heading
    const known = heading != null && heading >= 0
    return { position: [position.lat, position.lng], heading: known ? heading : 0, headingKnown: known }
  }, [active, position])
}
