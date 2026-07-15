import { useCallback, useEffect, useRef, useState } from 'react'
import { driverRideApi, type RouteStep, type TrafficInterval } from './ride-api'
import { decodePolyline } from './polyline'
import { bearingDeg, distanceAlongPolyline, haversineMetres, isTrustworthySnap, nearestPointOnPolyline } from './geo'

// Mirrors api/src/constants/limits.ts (driver app can't import server code — keep in sync).
const OFF_ROUTE_THRESHOLD_METRES = 40
const OFF_ROUTE_CONSECUTIVE_FIXES = 3
const REROUTE_COOLDOWN_SECONDS = 12
// Distance from a step's endpoint at which we consider that maneuver "reached."
const STEP_ADVANCE_THRESHOLD_METRES = 25
const BACKOFF_STEPS_MS = [2_000, 4_000, 8_000, 16_000]
// A fix within OFF_ROUTE_THRESHOLD_METRES of the polyline can still be on a different
// real road (parallel streets) — reject the snap if device heading disagrees with the
// matched segment's bearing by more than this, instead of force-snapping onto it.
const OFF_ROUTE_BEARING_THRESHOLD_DEG = 55
// ponytail: index-count proxy for "this snap jumped implausibly far ahead," not a real
// elapsed-time/speed check — tighten (or replace with a distance-along-route budget) if
// field data shows it's too loose.
const MAX_FORWARD_SEGMENT_JUMP = 80

export interface TurnByTurnState {
  steps: RouteStep[]
  encodedPolyline: string | undefined
  /** Congestion segments for the traffic-tinted route overlay — indices refer to
   *  `trafficPolyline`, not `encodedPolyline` (see google.provider.ts's RouteResult). */
  trafficIntervals: TrafficInterval[] | undefined
  trafficPolyline: string | undefined
  /** Which tier the current route came from — 'osrm'/'fallback' means no real
   *  turn-by-turn/voice/traffic (Google Directions was unreachable). */
  source: 'google' | 'osrm' | 'fallback'
  currentStep: RouteStep | null
  /** Distance remaining to the current step's endpoint, measured along the route
   *  geometry (not a straight-line chord) — so it's monotonically non-increasing as
   *  the driver advances even through a long curving "continue straight" step. */
  distanceToManeuver: number | null
  isOffRoute: boolean
  /** True while a reroute fetch has failed and is retrying — UI can show "reconnecting…". */
  isReconnecting: boolean
  loading: boolean
  /**
   * Current GPS fix projected onto the route geometry, plus the bearing of the
   * matched road segment — null when there's no route yet or the driver is
   * off-route (beyond OFF_ROUTE_THRESHOLD_METRES). Prefer this over the raw
   * `position`/device heading for the car marker and nav camera: raw GPS drifts
   * 5-30m in cities, which is what makes the marker float into the wrong lane
   * or face the wrong way relative to the road (see
   * docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 2).
   */
  snappedPosition: [number, number] | null
  snappedHeading: number | null
  /**
   * The polyline segment the last on-route snap landed on, monotonically
   * non-decreasing (never walks backward except when the route itself is
   * refetched) — used to trim the drawn route to what's still ahead (see
   * docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 7b). `null` before the first
   * successful snap; frozen (not reset) while briefly off-route.
   */
  snappedSegmentIndex: number | null
}

/**
 * Tracks a driver's progress along a route: fetches steps once per destination, snaps
 * each GPS fix to the route geometry, advances the current maneuver, and detects
 * off-route driving to trigger a reroute (cooldown + backoff, never dropping the
 * existing route on a failed fetch) — see docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md
 * Phase 1 items 2-3 for the network-resilience contract this implements.
 */
export function useTurnByTurn(
  position: [number, number] | null,
  destination: [number, number] | null,
  language = 'en',
  heading: number | null = null,
): TurnByTurnState {
  const [steps, setSteps] = useState<RouteStep[]>([])
  const [encodedPolyline, setEncodedPolyline] = useState<string | undefined>(undefined)
  const [trafficIntervals, setTrafficIntervals] = useState<TrafficInterval[] | undefined>(undefined)
  const [trafficPolyline, setTrafficPolyline] = useState<string | undefined>(undefined)
  const [source, setSource] = useState<'google' | 'osrm' | 'fallback'>('google')
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isOffRoute, setIsOffRoute] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [snappedPosition, setSnappedPosition] = useState<[number, number] | null>(null)
  const [snappedHeading, setSnappedHeading] = useState<number | null>(null)
  const [snappedSegmentIndex, setSnappedSegmentIndex] = useState<number | null>(null)
  const [distanceToManeuver, setDistanceToManeuver] = useState<number | null>(null)
  const lastSegmentIndex = useRef<number | null>(null)
  const stepIdxRef = useRef(0)
  const lastDistanceToManeuver = useRef<number | null>(null)

  const routePoints   = useRef<[number, number][]>([])  // concatenated decoded step polylines
  const stepStartIndex = useRef<number[]>([])           // routePoints index where each step begins
  const destRef        = useRef<[number, number] | null>(null)
  const offRouteStreak = useRef(0)
  const lastFetchAt    = useRef(0)
  const retryTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryAttempt   = useRef(0)
  const fetchSeq       = useRef(0)

  const fetchRoute = useCallback((origin: [number, number], dest: [number, number]) => {
    const seq = ++fetchSeq.current
    lastFetchAt.current = Date.now()
    setLoading(true)
    driverRideApi.getRoute(origin[0], origin[1], dest[0], dest[1], {
      language, withSteps: true, trafficAware: true, withTrafficIntervals: true,
    })
      .then(r => {
        if (fetchSeq.current !== seq) return
        // Haversine fallback returns an empty polyline/no steps instead of throwing —
        // treat that the same as a network failure so we keep retrying with backoff
        // instead of silently settling on "no route drawn."
        if (!r.polyline && (!r.steps || r.steps.length === 0)) {
          throw new Error('empty route')
        }
        const newSteps = r.steps ?? []
        setSteps(newSteps)
        setEncodedPolyline(r.polyline || undefined)
        setTrafficIntervals(r.trafficIntervals)
        setTrafficPolyline(r.trafficPolyline)
        setSource(r.source)
        setCurrentStepIndex(0)
        stepIdxRef.current = 0
        lastDistanceToManeuver.current = null
        {
          let cum = 0
          const starts: number[] = []
          const pts: [number, number][] = []
          for (const s of newSteps) {
            starts.push(cum)
            const decoded = decodePolyline(s.polyline)
            pts.push(...decoded)
            cum += decoded.length
          }
          stepStartIndex.current = starts
          routePoints.current = pts
        }
        lastSegmentIndex.current = null
        setSnappedSegmentIndex(null)
        setIsOffRoute(false)
        setIsReconnecting(false)
        offRouteStreak.current = 0
        retryAttempt.current = 0
        setLoading(false)
      })
      .catch(() => {
        if (fetchSeq.current !== seq) return
        // Never clear the existing route on a failed reroute — keep guiding against the
        // stale one, surface a passive "reconnecting" flag, retry with capped backoff.
        setIsReconnecting(true)
        setLoading(false)
        const delay = BACKOFF_STEPS_MS[Math.min(retryAttempt.current, BACKOFF_STEPS_MS.length - 1)]!
        retryAttempt.current += 1
        if (retryTimer.current) clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => {
          if (destRef.current) fetchRoute(origin, destRef.current)
        }, delay)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // Fetch when the destination changes, or once GPS first resolves for a destination
  // that was already set. Deliberately NOT keyed on `position` itself — must not
  // refetch on every GPS tick, only on these two triggers.
  useEffect(() => {
    destRef.current = destination
    if (!destination || !position) return
    fetchRoute(position, destination)
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.[0], destination?.[1], position != null])

  // Snap each new fix to the route, advance the current step, detect off-route.
  useEffect(() => {
    if (!position || routePoints.current.length === 0) return

    const snapped = nearestPointOnPolyline(position, routePoints.current)
    if (!snapped) return

    const segEnd = routePoints.current[snapped.segmentIndex + 1]
    const segStart = routePoints.current[snapped.segmentIndex]
    const segBearing = segEnd && segStart ? bearingDeg(segStart, segEnd) : null

    // A fix within OFF_ROUTE_THRESHOLD_METRES can still be on a different real road
    // (parallel streets) — reject the snap if heading disagrees with the matched
    // segment's bearing, instead of force-snapping onto the wrong street and drawing
    // a straight line to wherever that road's next point happens to be.
    const forwardJumpTooFar = lastSegmentIndex.current != null
      && snapped.segmentIndex - lastSegmentIndex.current > MAX_FORWARD_SEGMENT_JUMP

    let clampedIndex: number | null = null
    if (!isTrustworthySnap(snapped.distMetres, heading, segBearing, OFF_ROUTE_THRESHOLD_METRES, OFF_ROUTE_BEARING_THRESHOLD_DEG)
        || forwardJumpTooFar) {
      offRouteStreak.current += 1
      setSnappedPosition(null)
      setSnappedHeading(null)
    } else {
      offRouteStreak.current = 0
      setIsOffRoute(false)
      setSnappedPosition(snapped.point)
      setSnappedHeading(segBearing)
      // Never let progress walk backward — see snappedSegmentIndex's doc comment.
      clampedIndex = lastSegmentIndex.current == null
        ? snapped.segmentIndex
        : Math.max(snapped.segmentIndex, lastSegmentIndex.current)
      lastSegmentIndex.current = clampedIndex
      setSnappedSegmentIndex(clampedIndex)
    }

    if (offRouteStreak.current >= OFF_ROUTE_CONSECUTIVE_FIXES) {
      setIsOffRoute(true)
      const cooledDown = Date.now() - lastFetchAt.current >= REROUTE_COOLDOWN_SECONDS * 1000
      if (cooledDown && destRef.current) {
        offRouteStreak.current = 0
        fetchRoute(position, destRef.current)
      }
    }

    // Last point of a given step within the concatenated routePoints array (the point
    // where its polyline hands off to the next step, or the route's final point).
    const stepEndPointIndex = (i: number) => (stepStartIndex.current[i + 1] ?? routePoints.current.length) - 1

    const idx = stepIdxRef.current
    const step = steps[idx]
    let next = idx
    if (step) {
      const distToEnd = clampedIndex != null
        ? distanceAlongPolyline(snapped.point, clampedIndex, routePoints.current, stepEndPointIndex(idx))
        : haversineMetres(position, [step.endLat, step.endLng])
      if (distToEnd < STEP_ADVANCE_THRESHOLD_METRES && idx < steps.length - 1) next = idx + 1
    }
    // Self-heal: if the on-route snap is already past a later step's start (a
    // maneuver's 25m endpoint radius was missed, e.g. a wide/fast turn), jump
    // forward to match instead of leaving the banner frozen on a passed step.
    if (clampedIndex != null) {
      const starts = stepStartIndex.current
      for (let i = starts.length - 1; i > next; i--) {
        if (starts[i]! <= clampedIndex) { next = i; break }
      }
    }
    if (next !== idx) {
      stepIdxRef.current = next
      setCurrentStepIndex(next)
    }

    const finalStep = steps[next]
    if (finalStep) {
      // Measure along the route geometry, not a straight-line chord to the endpoint —
      // a chord can lengthen mid-curve even while the driver drives straight ahead
      // and makes real progress (see distanceAlongPolyline's doc comment). Only
      // recompute when this tick's snap is trustworthy; otherwise hold the last known
      // value rather than substitute a noisy straight-line reading.
      if (clampedIndex != null) {
        lastDistanceToManeuver.current =
          distanceAlongPolyline(snapped.point, clampedIndex, routePoints.current, stepEndPointIndex(next))
      } else if (lastDistanceToManeuver.current == null) {
        lastDistanceToManeuver.current = haversineMetres(position, [finalStep.endLat, finalStep.endLng])
      }
      setDistanceToManeuver(lastDistanceToManeuver.current)
    } else {
      lastDistanceToManeuver.current = null
      setDistanceToManeuver(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  const currentStep = steps[currentStepIndex] ?? null

  return {
    steps, encodedPolyline, trafficIntervals, trafficPolyline, source,
    currentStep, distanceToManeuver, isOffRoute, isReconnecting, loading,
    snappedPosition, snappedHeading, snappedSegmentIndex,
  }
}
