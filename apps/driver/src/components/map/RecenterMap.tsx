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
  /**
   * Fires once when the driver manually drags/zooms the map, so the screen can
   * pause auto-follow and show a "Re-center" chip. Bump `resumeKey` to resume.
   */
  onFollowChange?: (following: boolean) => void
  /** Bump (increment) to force auto-follow back on after onFollowChange(false). */
  resumeKey?: number
  /**
   * When true, RecenterMap does not touch the camera at all — e.g. while a
   * parent-owned one-shot fit-bounds beat (see FitBoundsToPoints) is driving
   * the camera instead. Flip back to false to resume; this forces every
   * camera property to re-apply, since the external fit-bounds call may have
   * silently changed pitch/heading/zoom without RecenterMap knowing.
   */
  suspended?: boolean
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
const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const HEADING_ANIM_MS = 350
// Mode-transition duration (overview <-> navigation dive) — see
// docs/DRIVER_TRIP_UX_REDESIGN_PLAN.md §1/§5. Pitch and zoom share this so a
// mode switch reads as one continuous camera move, not three separate snaps.
const CAMERA_ANIM_MS = 600

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
  onFollowChange,
  resumeKey,
  suspended = false,
}: RecenterMapProps) {
  const map = useMap()
  const last       = useRef<[number, number] | null>(null)
  const lastPad    = useRef<number>(-1)
  const lastHdg    = useRef<number>(-1)     // last heading value the ≥2° gate was checked against
  const appliedHdg = useRef<number | null>(null)  // heading actually applied to the map (post-animation)
  const headingRaf = useRef<number | null>(null)
  const lastPitch    = useRef<number | null>(null)
  const appliedPitch = useRef<number | null>(null)
  const pitchRaf     = useRef<number | null>(null)
  const lastZoom     = useRef<number | null>(null)
  const appliedZoom  = useRef<number | null>(null)
  const zoomRaf      = useRef<number | null>(null)
  // True while RecenterMap is allowed to drive the camera. A driver drag
  // gesture sets this false (and fires onFollowChange(false)); bumping
  // resumeKey sets it back true. Plain ref, not state — pausing must not
  // retrigger renders, only gate the next prop-driven effect run.
  const following  = useRef(!suspended)
  const onFollowChangeRef = useRef(onFollowChange)
  onFollowChangeRef.current = onFollowChange
  const prevResumeKey = useRef(resumeKey)
  const prevSuspended = useRef(suspended)
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

  // Same continuous-ease pattern as animateHeadingTo — eases pitch and zoom
  // over CAMERA_ANIM_MS so an overview<->navigation mode switch (pitch,
  // heading, zoom all changing together) reads as one camera move.
  function animatePitchTo(target: number) {
    if (!map) return
    if (pitchRaf.current !== null) cancelAnimationFrame(pitchRaf.current)
    if (appliedPitch.current === null) {
      map.setTilt(target)
      appliedPitch.current = target
      return
    }
    const start = appliedPitch.current
    const delta = target - start
    const startTime = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / CAMERA_ANIM_MS)
      const value = start + delta * easeInOutCubic(t)
      map.setTilt(value)
      appliedPitch.current = value
      pitchRaf.current = t < 1 ? requestAnimationFrame(step) : null
    }
    pitchRaf.current = requestAnimationFrame(step)
  }

  function animateZoomTo(target: number) {
    if (!map) return
    if (zoomRaf.current !== null) cancelAnimationFrame(zoomRaf.current)
    if (appliedZoom.current === null) {
      map.setZoom(target)
      appliedZoom.current = target
      return
    }
    const start = appliedZoom.current
    const delta = target - start
    const startTime = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / CAMERA_ANIM_MS)
      const value = start + delta * easeInOutCubic(t)
      map.setZoom(value)
      appliedZoom.current = value
      zoomRaf.current = t < 1 ? requestAnimationFrame(step) : null
    }
    zoomRaf.current = requestAnimationFrame(step)
  }

  useEffect(() => () => {
    if (headingRaf.current !== null) cancelAnimationFrame(headingRaf.current)
    if (pitchRaf.current   !== null) cancelAnimationFrame(pitchRaf.current)
    if (zoomRaf.current    !== null) cancelAnimationFrame(zoomRaf.current)
  }, [])

  // Driver drag pauses auto-follow; a bumped resumeKey resumes it and forces
  // every camera property to re-apply (see the reset below).
  useEffect(() => {
    if (!map) return
    const listener = map.addListener('dragstart', () => {
      if (!following.current) return
      following.current = false
      onFollowChangeRef.current?.(false)
    })
    return () => listener.remove()
  }, [map])

  useEffect(() => {
    if (resumeKey === undefined || prevResumeKey.current === resumeKey) return
    prevResumeKey.current = resumeKey
    following.current = true
    onFollowChangeRef.current?.(true)
    last.current      = null
    lastPad.current    = -1
    lastHdg.current    = -1
    lastPitch.current  = null
    lastZoom.current   = null
    setRetryCount(c => c + 1)
  }, [resumeKey])

  // Parent-driven mode switch (overview beat <-> navigation). Unlike the drag-
  // gesture pause above, resuming here must force a re-apply even though the
  // prop *values* (pitch/heading/etc.) may be unchanged — a fit-bounds call
  // during the suspension could have silently moved the real camera away
  // from what RecenterMap last applied.
  useEffect(() => {
    if (prevSuspended.current === suspended) return
    prevSuspended.current = suspended
    following.current = !suspended
    onFollowChangeRef.current?.(!suspended)
    if (!suspended) {
      last.current      = null
      lastPad.current    = -1
      lastHdg.current    = -1
      lastPitch.current  = null
      lastZoom.current   = null
      setRetryCount(c => c + 1)
    }
  }, [suspended])

  useEffect(() => {
    if (!map || typeof pitch !== 'number' || !following.current) return
    if (lastPitch.current === pitch) return
    lastPitch.current = pitch
    animatePitchTo(pitch)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pitch, retryCount])

  useEffect(() => {
    if (!map || distanceToManeuver == null || !following.current) return
    const target = zoomForDistance(distanceToManeuver)
    if (lastZoom.current === target) return
    lastZoom.current = target
    animateZoomTo(target)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, distanceToManeuver, retryCount])

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
    if (!map || !following.current) return
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
