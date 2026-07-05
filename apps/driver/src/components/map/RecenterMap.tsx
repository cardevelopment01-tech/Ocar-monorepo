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

// Compute a shifted lat/lng so that the target appears at the visible-area
// center (between topPadding and bottomPadding), not the geometric viewport center.
function shiftedCenter(
  map: ReturnType<typeof useMap>,
  lat: number,
  lng: number,
  topPadding: number,
  bottomPadding: number,
): { lat: number; lng: number } {
  if (!map || (topPadding === 0 && bottomPadding === 0)) return { lat, lng }
  try {
    const proj = map.getProjection()
    const zoom = map.getZoom()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google
    if (!proj || zoom == null || !g?.maps) return { lat, lng }
    const worldPt = proj.fromLatLngToPoint(new g.maps.LatLng(lat, lng))
    if (!worldPt) return { lat, lng }
    // Shift the pan center south so the target appears in the visible area
    // (above the sheet). bottomPadding > topPadding → positive deltaY → south.
    const scale  = Math.pow(2, zoom)
    const deltaY = (bottomPadding - topPadding) / 2 / scale
    const shifted = proj.fromPointToLatLng(new g.maps.Point(worldPt.x, worldPt.y + deltaY))
    if (!shifted) return { lat, lng }
    return { lat: shifted.lat(), lng: shifted.lng() }
  } catch {
    return { lat, lng }
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

    const target = shiftedCenter(map, lat, lng, topPadding, bottomPadding)

    if (animate && moved) {
      map.panTo(target)
    } else {
      map.moveCamera({ center: target })
    }
  }, [center, bottomPadding, topPadding, map, animate, heading])

  return null
}
