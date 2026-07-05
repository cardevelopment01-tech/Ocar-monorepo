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

// Returns null when projection is not ready yet (caller should retry).
function shiftedCenter(
  map: ReturnType<typeof useMap>,
  lat: number,
  lng: number,
  topPadding: number,
  bottomPadding: number,
): { lat: number; lng: number } | null {
  if (!map) return null
  if (topPadding === 0 && bottomPadding === 0) return { lat, lng }
  try {
    const proj = map.getProjection()
    const zoom = map.getZoom()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google
    if (!proj || zoom == null || !g?.maps) return null
    const worldPt = proj.fromLatLngToPoint(new g.maps.LatLng(lat, lng))
    if (!worldPt) return null
    // Shift the pan center south so the driver appears in the visible area
    // above the bottom sheet, not at the raw geometric viewport center.
    const scale  = Math.pow(2, zoom)
    const deltaY = (bottomPadding - topPadding) / 2 / scale
    const shifted = proj.fromPointToLatLng(new g.maps.Point(worldPt.x, worldPt.y + deltaY))
    if (!shifted) return null
    return { lat: shifted.lat(), lng: shifted.lng() }
  } catch {
    return null
  }
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

  // Increments when the map's projection becomes available (tilesloaded).
  // This re-runs the centering effect so the offset is computed correctly.
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!map) return
    // If projection is already available (common on subsequent renders), skip.
    if (map.getProjection() && map.getZoom() != null) return
    // Wait for tilesloaded which guarantees projection + zoom are set.
    const listener = map.addListener('tilesloaded', () => {
      listener.remove()
      // Reset refs so the centering effect re-applies with the correct offset.
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

    if (typeof heading === 'number') {
      map.setHeading(heading)
      lastHdg.current = heading
    }

    const target = shiftedCenter(map, lat, lng, topPadding, bottomPadding)

    if (target === null) {
      // Projection not ready — don't update refs so the tilesloaded retry fires.
      return
    }

    last.current    = [lat, lng]
    lastPad.current = bottomPadding

    if (animate && moved) {
      map.panTo(target)
    } else {
      map.moveCamera({ center: target })
    }
  // retryCount is intentionally in deps: it re-runs this effect after tilesloaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, bottomPadding, topPadding, map, animate, heading, retryCount])

  return null
}
