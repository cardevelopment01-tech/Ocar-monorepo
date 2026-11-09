import { useEffect, useState } from 'react'

// react-native-maps' native `animateMarkerToCoordinate` CRASHES THE WHOLE APP (a NullPointerException on the next animation
// frame) when it is called before the map has created the native marker: the animator is built with no marker to read a start
// position from. A marker only exists once the map is ready (markers mounted earlier are created when it becomes ready), so a
// marker may animate only after `ready` has been true for a short while. Until then updates are simply held: the marker keeps
// its first position and glides to the latest one when it settles.
const SETTLE_MS = 800

export function useMarkerSettled(ready: boolean): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!ready) {
      setSettled(false)
      return
    }
    const t = setTimeout(() => setSettled(true), SETTLE_MS)
    return () => clearTimeout(t)
  }, [ready])
  return settled
}
