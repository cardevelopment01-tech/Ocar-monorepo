import { useCallback, useEffect, useRef, useState } from 'react'
import { driverRideApi, type RouteStep, type TrafficInterval } from './ride-api'
import { decodePolyline } from './polyline'
import { haversineMetres, nearestPointOnPolyline } from './geo'

// Mirrors api/src/constants/limits.ts (driver app can't import server code — keep in sync).
const OFF_ROUTE_THRESHOLD_METRES = 40
const OFF_ROUTE_CONSECUTIVE_FIXES = 3
const REROUTE_COOLDOWN_SECONDS = 12
// Distance from a step's endpoint at which we consider that maneuver "reached."
const STEP_ADVANCE_THRESHOLD_METRES = 25
const BACKOFF_STEPS_MS = [2_000, 4_000, 8_000, 16_000]

export interface TurnByTurnState {
  steps: RouteStep[]
  encodedPolyline: string | undefined
  /** Congestion segments for the traffic-tinted route overlay — indices refer to
   *  `trafficPolyline`, not `encodedPolyline` (see google.provider.ts's RouteResult). */
  trafficIntervals: TrafficInterval[] | undefined
  trafficPolyline: string | undefined
  currentStep: RouteStep | null
  /** Straight-line distance to the current step's endpoint — an approximation that
   *  holds well in practice since Google splits steps at bends, not mid-curve. */
  distanceToManeuver: number | null
  isOffRoute: boolean
  /** True while a reroute fetch has failed and is retrying — UI can show "reconnecting…". */
  isReconnecting: boolean
  loading: boolean
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
): TurnByTurnState {
  const [steps, setSteps] = useState<RouteStep[]>([])
  const [encodedPolyline, setEncodedPolyline] = useState<string | undefined>(undefined)
  const [trafficIntervals, setTrafficIntervals] = useState<TrafficInterval[] | undefined>(undefined)
  const [trafficPolyline, setTrafficPolyline] = useState<string | undefined>(undefined)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isOffRoute, setIsOffRoute] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [loading, setLoading] = useState(false)

  const routePoints   = useRef<[number, number][]>([])  // concatenated decoded step polylines
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
        setCurrentStepIndex(0)
        routePoints.current = newSteps.flatMap(s => decodePolyline(s.polyline))
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

    if (snapped.distMetres > OFF_ROUTE_THRESHOLD_METRES) {
      offRouteStreak.current += 1
    } else {
      offRouteStreak.current = 0
      setIsOffRoute(false)
    }

    if (offRouteStreak.current >= OFF_ROUTE_CONSECUTIVE_FIXES) {
      setIsOffRoute(true)
      const cooledDown = Date.now() - lastFetchAt.current >= REROUTE_COOLDOWN_SECONDS * 1000
      if (cooledDown && destRef.current) {
        offRouteStreak.current = 0
        fetchRoute(position, destRef.current)
      }
    }

    setCurrentStepIndex(idx => {
      const step = steps[idx]
      if (!step) return idx
      const distToEnd = haversineMetres(position, [step.endLat, step.endLng])
      if (distToEnd < STEP_ADVANCE_THRESHOLD_METRES && idx < steps.length - 1) return idx + 1
      return idx
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  const currentStep = steps[currentStepIndex] ?? null
  const distanceToManeuver = position && currentStep
    ? haversineMetres(position, [currentStep.endLat, currentStep.endLng])
    : null

  return {
    steps, encodedPolyline, trafficIntervals, trafficPolyline,
    currentStep, distanceToManeuver, isOffRoute, isReconnecting, loading,
  }
}
