import { useEffect, useRef } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

interface RecenterMapProps {
  center: [number, number]
  bottomPadding?: number
  topPadding?: number
  animate?: boolean
  /** When set, rotates the map to match driver heading. */
  heading?: number
}

export default function RecenterMap({
  center,
  bottomPadding = 0,
  topPadding = 0,
  animate = true,
  heading,
}: RecenterMapProps) {
  const map = useMap()
  const last    = useRef<[number, number] | null>(null)
  const lastPad = useRef<number>(-1)
  const lastHdg = useRef<number>(-1)

  useEffect(() => {
    if (!map) return
    const [lat, lng] = center
    const prev    = last.current
    const moved   = !prev || Math.abs(prev[0] - lat) >= 2e-5 || Math.abs(prev[1] - lng) >= 2e-5
    const padChgd = Math.abs(lastPad.current - bottomPadding) >= 1
    const hdgChgd = typeof heading === 'number' && Math.abs(lastHdg.current - heading) >= 2
    if (!moved && !padChgd && !hdgChgd) return

    last.current    = [lat, lng]
    lastPad.current = bottomPadding
    if (typeof heading === 'number') lastHdg.current = heading

    if (typeof heading === 'number') {
      map.setHeading(heading)
    }

    const paddingOption = (topPadding > 0 || bottomPadding > 0)
      ? { top: topPadding, bottom: bottomPadding, left: 0, right: 0 }
      : undefined

    if (animate && moved) {
      map.panTo({ lat, lng })
      if (paddingOption) map.setOptions({ paddingFraction: undefined })
    } else {
      map.moveCamera({ center: { lat, lng } })
    }
  }, [center, bottomPadding, topPadding, map, animate, heading])

  return null
}
