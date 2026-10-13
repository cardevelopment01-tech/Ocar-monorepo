import { useEffect, useRef, useState } from 'react'
import { useDriverPositionStore, type DriverPosition } from '@/services/location/driverPositionStore'
import { fetchSpeedLimitCities } from './api'
import { classifyLimit, HIGHWAY_SPEED_LIMIT_KMPH, stepSpeedAlert, type SpeedAlertState, type SpeedLimitCity } from './speedAlert'

const MPS_TO_KMPH = 3.6

// City centroids/speed limits essentially never change -- cached at module
// scope (survives across rides in the same app session) instead of
// re-fetching GET /geo/cities on every single ride (code-review finding,
// 2026-09-22: a 20-ride shift was firing 20 redundant round-trips for
// identical data).
let citiesCache: Promise<SpeedLimitCity[]> | null = null
function getSpeedLimitCities(): Promise<SpeedLimitCity[]> {
  if (!citiesCache) {
    citiesCache = fetchSpeedLimitCities().catch((err) => {
      citiesCache = null // let the next ride retry instead of caching a failure forever
      throw err
    })
  }
  return citiesCache
}

/**
 * Driver-facing over-speed alert. Reuses `useDriverPositionStore`'s existing
 * GPS stream (fed by `backgroundTask.ts`) rather than opening a second
 * location subscription -- matches the Stage 0 "one GPS subscription total"
 * design (docs/superpowers/specs/2026-09-19-post-day10-ride-flow-hardening-design.md).
 *
 * Unlike web driver (voice-only), this returns a bump counter for a visual
 * toast -- the hardening doc's Stage 4 stacking priority locks speed alerts
 * as a "transient toast (auto-dismissing)", not audio, for mobile.
 */
export function useSpeedAlert(enabled: boolean): { alertKey: number; limitKmph: number } {
  const [cities, setCities] = useState<SpeedLimitCity[]>([])
  const [alertKey, setAlertKey] = useState(0)
  const [limitKmph, setLimitKmph] = useState(HIGHWAY_SPEED_LIMIT_KMPH)
  const stateRef = useRef<SpeedAlertState>({ overSince: null, lastAlertAt: 0 })
  const limitRef = useRef(HIGHWAY_SPEED_LIMIT_KMPH)
  const citiesRef = useRef<SpeedLimitCity[]>([])
  citiesRef.current = cities

  useEffect(() => {
    if (!enabled) return
    getSpeedLimitCities().then(setCities).catch(() => {})
  }, [enabled])

  // Plain store subscription instead of a React-state selector: the hook's host (the whole
  // ride screen) no longer re-renders on every GPS tick, only when the limit or alert
  // actually changes. Nothing is subscribed at all while the alert is off.
  useEffect(() => {
    if (!enabled) return
    function onPosition(position: DriverPosition | null) {
      if (!position || position.speed == null) return
      const list = citiesRef.current
      const limit = list.length ? classifyLimit([position.lat, position.lng], list) : HIGHWAY_SPEED_LIMIT_KMPH
      if (limit !== limitRef.current) {
        limitRef.current = limit
        setLimitKmph(limit)
      }
      const speedKmph = position.speed * MPS_TO_KMPH
      const { state, alert } = stepSpeedAlert(stateRef.current, speedKmph, limit, Date.now())
      stateRef.current = state
      if (alert) setAlertKey((k) => k + 1)
    }
    onPosition(useDriverPositionStore.getState().position)
    return useDriverPositionStore.subscribe((state, prev) => {
      if (state.position !== prev.position) onPosition(state.position)
    })
  }, [enabled])

  return { alertKey, limitKmph }
}
