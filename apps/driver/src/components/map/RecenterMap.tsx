import { useEffect, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'

interface RecenterMapProps {
  center: [number, number]
  bottomPadding?: number
  topPadding?: number
  animate?: boolean
}

export default function RecenterMap({
  center,
  bottomPadding = 0,
  topPadding = 0,
  animate = true,
}: RecenterMapProps) {
  const { current: map } = useMap()
  const last    = useRef<[number, number] | null>(null)
  const lastPad = useRef<number>(-1)

  useEffect(() => {
    if (!map) return
    const [lat, lng] = center
    const prev    = last.current
    const moved   = !prev || Math.abs(prev[0] - lat) >= 2e-5 || Math.abs(prev[1] - lng) >= 2e-5
    const padChgd = Math.abs(lastPad.current - bottomPadding) >= 1
    if (!moved && !padChgd) return

    last.current    = [lat, lng]
    lastPad.current = bottomPadding

    map.easeTo({
      center:   [lng, lat],
      padding:  { top: topPadding, bottom: bottomPadding, left: 0, right: 0 },
      // instant re-pad when GPS didn't move — no jarring camera pan
      duration: animate && moved ? 600 : 0,
    })
  }, [center, bottomPadding, topPadding, map, animate])

  return null
}
