import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { pickupWait, pickupWaitCopy, type PickupWaitAudience, type PickupWaitCopy, type PickupWaitState } from '../utils/pickupWait'

const TICK_MS = 1000
// The clock starts on the server once the driver's position reaches the pickup, which the phone only learns by asking again.
const REFRESH_MS = 15_000

export interface PickupWaitRide {
  status?: string | null | undefined
  pickupWaitStartedAt?: string | null | undefined
  pickupFreeWaitMin?: number | null | undefined
  pickupWaitPerMin?: string | number | null | undefined
}

/**
 * The live waiting clock at the pickup. `now` is the app's server-corrected clock (serverNow()). `copy` is null when there is nothing
 * to show (not at the pickup, an older ride booked before waiting charges, or, for the rider, before the driver is really there).
 * While the driver has tapped "arrived" but the clock has not started, `onNeedRefresh` is called every 15 s so the phone picks up the start.
 */
export function usePickupWait(
  ride: PickupWaitRide | null,
  opts: { now: () => number; audience: PickupWaitAudience; onNeedRefresh?: () => void },
): { state: PickupWaitState; copy: PickupWaitCopy | null } {
  const status = ride?.status ?? null
  const startedAt = ride?.pickupWaitStartedAt ?? null
  const freeMin = ride?.pickupFreeWaitMin ?? null
  const rawRate = ride?.pickupWaitPerMin
  const perMin = rawRate == null ? null : Number(rawRate)

  const nowRef = useRef(opts.now)
  nowRef.current = opts.now
  const refreshRef = useRef(opts.onNeedRefresh)
  refreshRef.current = opts.onNeedRefresh
  const compute = () => pickupWait({ status, startedAt, freeMin, now: nowRef.current() })

  const [state, setState] = useState<PickupWaitState>(compute)
  const lastKind = useRef<PickupWaitState['kind']>(state.kind)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let refresher: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      const next = compute()
      setState(next)
      // Nothing to count while there is no clock; the refresher (below) is what wakes a pending clock.
      if (next.kind === 'free' || next.kind === 'charging') timer = setTimeout(tick, TICK_MS)
    }
    tick()
    if (status === 'driver_arrived' && !startedAt && freeMin != null) {
      // Ask at once (the driver may already be at the pickup, so "not started" should not linger), then every 15 s while it stays unstarted.
      refreshRef.current?.()
      refresher = setInterval(() => refreshRef.current?.(), REFRESH_MS)
    }
    return () => { clearTimeout(timer); clearInterval(refresher) }
    // compute closes over exactly these three values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, startedAt, freeMin])

  const copy = pickupWaitCopy(state, opts.audience, { perMin })

  useEffect(() => {
    // Only the moment the free minutes run out is worth announcing; the countdown itself is not read every second.
    if (state.kind !== lastKind.current && state.kind === 'charging' && copy) {
      AccessibilityInfo.announceForAccessibility(copy.a11y)
    }
    lastKind.current = state.kind
  }, [state.kind, copy])

  return { state, copy }
}
