import { useEffect, useState } from 'react'
import * as Location from 'expo-location'

export type DriverLivePosition = {
  position: [number, number]
  heading: number
  /** False until the device reports a real GPS heading (Android returns 0,
   *  iOS returns a negative value, when heading isn't known yet) -- avoids a
   *  fake north-snap on the car marker, matching web's CarMarker convention. */
  headingKnown: boolean
} | null

// The active-ride screen needs the driver's OWN live position for the map
// marker -- confirmed (outside review) that `backgroundTask.ts`'s location
// ticks only flow to the server, never back into React state, so this is a
// separate, local-only subscription. `expo-location` already provides a real
// GPS heading field directly, so unlike the web app (which derives heading
// from two relayed fixes) no synthetic bearing calculation is needed here.
export function useDriverLivePosition(active: boolean): DriverLivePosition {
  const [state, setState] = useState<DriverLivePosition>(null)

  useEffect(() => {
    if (!active) {
      setState(null)
      return
    }
    let subscription: Location.LocationSubscription | null = null
    let cancelled = false

    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => {
        if (cancelled || status !== 'granted') return
        return Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
          (fix) => {
            const heading = fix.coords.heading
            setState({
              position: [fix.coords.latitude, fix.coords.longitude],
              heading: heading != null && heading >= 0 ? heading : 0,
              headingKnown: heading != null && heading >= 0,
            })
          }
        )
      })
      .then((sub) => {
        if (sub) subscription = sub
      })
      .catch(() => {})

    return () => {
      cancelled = true
      subscription?.remove()
    }
  }, [active])

  return state
}
