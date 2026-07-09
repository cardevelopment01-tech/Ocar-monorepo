import { useEffect, useRef, useState } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

interface RecenterMapProps {
  center: [number, number]
  bottomPadding?: number
  topPadding?: number
  animate?: boolean
  /** When set, rotates the map to match driver heading. */
  heading?: number
}

// Shift the pan center south so the target appears in the visible area between
// topPadding and bottomPadding instead of at the raw geometric viewport center.
// Uses Mercator approximation, only requires map.getZoom(), not getProjection().
// Returns null when zoom is not yet available (caller skips and retries later).
function paddedCenter(
  zoom: number | undefined,
  lat: number,
  lng: number,
  topPadding: number,
  bottomPadding: number,
): { lat: number; lng: number } | null {
  if (zoom == null) return null
  if (topPadding === 0 && bottomPadding === 0) return { lat, lng }
  // Degrees of latitude per screen pixel at this zoom level and latitude.
  const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom)
  const degPerPx = mpp / 111320
  // Positive pixelShift (bottomPadding > topPadding) shifts south, driver stays above center.
  const pixelShift = (bottomPadding - topPadding) / 2
  return { lat: lat - degPerPx * pixelShift, lng }
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
  // Bumped by the tilesloaded listener to force a re-centre after the map
  // has fully loaded (guarantees getZoom() is set, even with Cloud mapId).
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!map) return
    // Always register a one-shot tilesloaded listener on mount.
    // tilesloaded fires after the initial render when zoom is guaranteed set.
    const listener = map.addListener('tilesloaded', () => {
      listener.remove()
      last.current    = null
      lastPad.current = -1
      setRetryCount(c => c + 1)
    })
    return () => listener.remove()
  }, [map])

  useEffect(() => {
    if (!map) return
    const [lat, lng] = center
    const prev    = last.current
    const moved   = !prev || Math.abs(prev[0] - lat) >= 2e-5 || Math.abs(prev[1] - lng) >= 2e-5
    const padChgd = Math.abs(lastPad.current - bottomPadding) >= 1
    const hdgChgd = typeof heading === 'number' && Math.abs(lastHdg.current - heading) >= 2

    if (!moved && !padChgd && !hdgChgd) return

    if (typeof heading === 'number' && hdgChgd) {
      map.setHeading(heading)
      lastHdg.current = heading
    }

    if (!moved && !padChgd) return  // heading-only update, done

    const target = paddedCenter(map.getZoom(), lat, lng, topPadding, bottomPadding)
    if (target === null) return  // zoom not ready yet; tilesloaded will retry

    last.current    = [lat, lng]
    lastPad.current = bottomPadding

    if (animate && moved) {
      map.panTo(target)
    } else {
      map.moveCamera({ center: target })
    }
  // retryCount is intentional: re-runs this effect after tilesloaded fires.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, bottomPadding, topPadding, map, animate, heading, retryCount])

  return null
}
