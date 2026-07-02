import { useEffect, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'

interface RecenterMapProps {
  center: [number, number]
  bottomPadding?: number
  topPadding?: number
  animate?: boolean
  /** When set, activates navigation-camera mode: pitch=50, bearing=heading. */
  heading?: number
}

export default function RecenterMap({
  center,
  bottomPadding = 0,
  topPadding = 0,
  animate = true,
  heading,
}: RecenterMapProps) {
  const { current: map } = useMap()
  const last    = useRef<[number, number] | null>(null)
  const lastPad = useRef<number>(-1)
  const lastHdg = useRef<number>(-1)

  useEffect(() => {
    if (!map) return
    const [lat, lng] = center
    const prev      = last.current
    const moved     = !prev || Math.abs(prev[0] - lat) >= 2e-5 || Math.abs(prev[1] - lng) >= 2e-5
    const padChgd   = Math.abs(lastPad.current - bottomPadding) >= 1
    const hdgChgd   = typeof heading === 'number' && Math.abs(lastHdg.current - heading) >= 2
    if (!moved && !padChgd && !hdgChgd) return

    last.current    = [lat, lng]
    lastPad.current = bottomPadding
    if (typeof heading === 'number') lastHdg.current = heading

    map.easeTo({
      center:   [lng, lat],
      padding:  { top: topPadding, bottom: bottomPadding, left: 0, right: 0 },
      pitch:    typeof heading === 'number' ? 50 : 0,
      bearing:  typeof heading === 'number' ? heading : 0,
      // instant re-pad when GPS didn't move — no jarring camera pan
      duration: animate && moved ? 600 : 0,
    })
  }, [center, bottomPadding, topPadding, map, animate, heading])

  return null
}
