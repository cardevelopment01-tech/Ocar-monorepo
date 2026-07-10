import { useEffect, useRef, useState } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

interface RecenterMapProps {
  center: [number, number]
  bottomPadding?: number
  topPadding?: number
  animate?: boolean
  /** When set, rotates the map to match driver heading. */
  heading?: number
  /** Camera tilt in degrees (e.g. 45-60 for a heading-up navigation view). */
  pitch?: number
  /**
   * Distance (metres) to the next maneuver — when provided, zooms in as the driver
   * approaches a turn and back out on straightaways. Omit on non-navigation screens
   * (e.g. the idle/online map) to leave zoom under manual/default control.
   */
  distanceToManeuver?: number | null
}

// Tighter near an upcoming turn, wider with more room to see ahead on a straightaway.
function zoomForDistance(distanceMetres: number): number {
  if (distanceMetres < 100) return 18
  if (distanceMetres < 300) return 17
  return 16
}

// Shortest signed delta (degrees) from `from` to `to`, e.g. 350 -> 10 gives +20, not -340.
function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const HEADING_ANIM_MS = 350

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
  pitch,
  distanceToManeuver,
}: RecenterMapProps) {
  const map = useMap()
  const last       = useRef<[number, number] | null>(null)
  const lastPad    = useRef<number>(-1)
  const lastHdg    = useRef<number>(-1)     // last heading value the ≥2° gate was checked against
  const appliedHdg = useRef<number | null>(null)  // heading actually applied to the map (post-animation)
  const headingRaf = useRef<number | null>(null)
  const lastPitch  = useRef<number | null>(null)
  const lastZoom   = useRef<number | null>(null)
  // Bumped by the tilesloaded listener to force a re-centre after the map
  // has fully loaded (guarantees getZoom() is set, even with Cloud mapId).
  const [retryCount, setRetryCount] = useState(0)

  // Smoothly rotate the map from its current heading to `target`, so the camera eases
  // through turns instead of hard-snapping (matches SelfCarMarker's own transition cadence
  // — see docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md §1.1 for why a hard setHeading() was
  // the visible "jump" half of the double-rotation bug).
  function animateHeadingTo(target: number) {
    if (!map) return
    if (headingRaf.current !== null) cancelAnimationFrame(headingRaf.current)

    if (appliedHdg.current === null) {
      // First heading ever applied on this map instance: snap, nothing to ease from.
      map.setHeading(target)
      appliedHdg.current = target
      return
    }

    const start = appliedHdg.current
    const delta = shortestAngleDelta(start, target)
    const startTime = performance.now()

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / HEADING_ANIM_MS)
      const eased = easeOutCubic(t)
      const value = (start + delta * eased + 360) % 360
      map.setHeading(value)
      appliedHdg.current = value
      if (t < 1) {
        headingRaf.current = requestAnimationFrame(step)
      } else {
        headingRaf.current = null
      }
    }
    headingRaf.current = requestAnimationFrame(step)
  }

  useEffect(() => () => {
    if (headingRaf.current !== null) cancelAnimationFrame(headingRaf.current)
  }, [])

  useEffect(() => {
    if (!map || typeof pitch !== 'number') return
    if (lastPitch.current === pitch) return
    lastPitch.current = pitch
    map.setTilt(pitch)
  }, [map, pitch])

  useEffect(() => {
    if (!map || distanceToManeuver == null) return
    const target = zoomForDistance(distanceToManeuver)
    if (lastZoom.current === target) return
    lastZoom.current = target
    map.setZoom(target)
  }, [map, distanceToManeuver])

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
      animateHeadingTo(heading)
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
