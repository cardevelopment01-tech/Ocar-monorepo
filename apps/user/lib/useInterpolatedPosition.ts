import { useState, useEffect, useRef } from 'react'
import { bearingDeg, haversineMetres, nearestPointOnPolyline } from './geo'

// Matches the 3s driver sync interval, car glides continuously with no pause between fixes
const DURATION = 3_000

// Matches the driver app's OFF_ROUTE_THRESHOLD_METRES (apps/driver/src/lib/useTurnByTurn.ts)
// — inside this corridor of the route line, trust the snapped point over raw GPS.
const ROUTE_SNAP_CORRIDOR_METRES = 40

function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return (from + delta * t + 360) % 360
}

/**
 * Smoothly interpolates driver position and heading between raw socket fixes.
 *
 * Position uses linear interpolation over the full sync interval so the car
 * moves at constant speed with no pause, same as Uber/Ola.
 *
 * When `routePoints` (the decoded route polyline) is passed and the raw fix
 * falls within ROUTE_SNAP_CORRIDOR_METRES of it, both the animation target
 * and the heading are taken from the route geometry (the nearest point on
 * the line, and that segment's bearing) instead of the raw fix. Raw GPS
 * drifts 5-30m in cities, which is what previously put the marker in the
 * wrong lane and made heading flip unpredictably as jittery fixes crossed
 * the 8m movement threshold — snapping to a segment bearing that can only
 * point along the road fixes both (see docs/DRIVER_USER_MAP_UX_FIX_PLAN.md
 * Phase 2). Falls back to raw-fix bearing when there's no route yet or the
 * driver is off-route.
 *
 * Heading is never taken from raw device coords.heading, which is unreliable
 * on many devices. That means no real heading exists until a second fix
 * arrives >8m from the first (or a route snap succeeds) — `headingKnown`
 * stays false until then, so callers can render a neutral/undirected marker
 * instead of guessing (previously this defaulted to a fake 0°/north on the
 * very first fix — see docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md §1.1).
 */
export function useInterpolatedPosition(
  rawPos: [number, number] | undefined,
  routePoints?: [number, number][],
): { pos: [number, number] | undefined; heading: number; headingKnown: boolean } {
  const [pos,          setPos]          = useState<[number, number] | undefined>(rawPos)
  const [heading,       setHeading]      = useState(0)
  const [headingKnown, setHeadingKnown] = useState(false)

  const rafRef  = useRef<number | null>(null)
  const livePos = useRef<[number, number] | null>(null)
  const liveHdg = useRef(0)
  const hdgKnown = useRef(false)
  const anim    = useRef<{
    from: [number, number]; fromHdg: number
    to:   [number, number]; toHdg:   number
    start: number
  } | null>(null)

  useEffect(() => {
    if (!rawPos) return

    // First fix: snap position immediately, but there's no direction of travel yet
    // to derive a bearing from — leave heading unknown rather than faking one.
    if (!livePos.current) {
      livePos.current = rawPos
      setPos(rawPos)
      return
    }

    // Snap to the route line when close enough to it — see the hook doc comment.
    const snapped = routePoints && routePoints.length > 1
      ? nearestPointOnPolyline(rawPos, routePoints)
      : null
    const onRoute = snapped !== null && snapped.distMetres <= ROUTE_SNAP_CORRIDOR_METRES

    let target: [number, number]
    let toHdg: number
    if (onRoute) {
      target = snapped!.point
      const segStart = routePoints![snapped!.segmentIndex]
      const segEnd   = routePoints![snapped!.segmentIndex + 1]
      toHdg = segEnd && segStart ? bearingDeg(segStart, segEnd) : liveHdg.current
      hdgKnown.current = true
    } else {
      // Derive heading from direction of travel; keep current heading if nearly stationary
      target = rawPos
      const dist = haversineMetres(livePos.current, rawPos)
      toHdg = dist > 8 ? bearingDeg(livePos.current, rawPos) : liveHdg.current
      if (dist > 8) hdgKnown.current = true
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    anim.current = {
      from:    livePos.current,
      fromHdg: liveHdg.current,
      to:      target,
      toHdg,
      start:   performance.now(),
    }

    const tick = (now: number) => {
      const a = anim.current!
      const t = Math.min((now - a.start) / DURATION, 1)

      // Linear, constant speed produces continuous Uber-like motion with no deceleration pause
      const lat = a.from[0] + (a.to[0] - a.from[0]) * t
      const lng = a.from[1] + (a.to[1] - a.from[1]) * t
      const hdg = lerpAngle(a.fromHdg, a.toHdg, t)

      livePos.current = [lat, lng]
      liveHdg.current = hdg
      setPos([lat, lng])
      setHeading(hdg)
      if (hdgKnown.current) setHeadingKnown(true)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  // rawPos is a new array reference on each socket event, intentional dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPos])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  return { pos, heading, headingKnown }
}
