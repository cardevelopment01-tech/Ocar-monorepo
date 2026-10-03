import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { formatCurrency } from '../utils/currency'
import {
  tripWindow, tripWindowCopy,
  type TripWindowAudience, type TripWindowCopy, type TripWindowState,
} from '../utils/tripWindow'

const FAST_MS = 1000
const SLOW_MS = 30_000

// How long until the display or a boundary can next change. Per-second only where the seconds are
// shown (grace countdown, overtime, last 5 minutes); otherwise the minute-resolution text only needs
// a nudge, but never sleep past a state boundary.
function nextDelay(state: TripWindowState): number {
  switch (state.kind) {
    case 'none': return SLOW_MS
    case 'grace':
    case 'overtime': return FAST_MS
    case 'final': return state.msLeft <= 5 * 60_000 ? FAST_MS : Math.min(SLOW_MS, state.msLeft - 5 * 60_000 + 1)
    case 'running': return Math.min(SLOW_MS, Math.max(250, state.msLeft - 15 * 60_000 + 1))
  }
}

// Moments a screen reader user must hear even though the value is not announced every tick.
const ANNOUNCED: ReadonlyArray<TripWindowState['kind']> = ['final', 'grace', 'overtime']

export interface TripWindowRide {
  bookedUntil?: string | null | undefined
  overtimeGraceMin?: number | null | undefined
  overtimeRate?: number | null | undefined
}

/**
 * The live booked-window clock for a ride. `now` is the app's server-corrected clock (serverNow()), so a
 * skewed phone clock cannot move the state. `copy` is null when the ride has no window. Used by the
 * driver and rider apps so both phones show the same state at the same instant.
 */
export function useTripWindow(
  ride: TripWindowRide | null,
  opts: { now: () => number; audience: TripWindowAudience },
): { state: TripWindowState; copy: TripWindowCopy | null } {
  const bookedUntil = ride?.bookedUntil ?? null
  const graceMin = ride?.overtimeGraceMin ?? null
  const rate = ride?.overtimeRate ?? null
  const nowRef = useRef(opts.now)
  nowRef.current = opts.now
  const compute = () => tripWindow({ bookedUntil, graceMin, overtimeRate: rate, now: nowRef.current() })

  const [state, setState] = useState<TripWindowState>(compute)
  const lastKind = useRef<TripWindowState['kind']>(state.kind)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const next = compute()
      setState(next)
      timer = setTimeout(tick, nextDelay(next))
    }
    tick()
    return () => clearTimeout(timer)
    // compute closes over exactly these three values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookedUntil, graceMin, rate])

  const copy = tripWindowCopy(state, opts.audience, { overtimeRate: rate, graceMin, rupees: formatCurrency })

  useEffect(() => {
    if (state.kind !== lastKind.current && ANNOUNCED.includes(state.kind) && copy) {
      AccessibilityInfo.announceForAccessibility(copy.a11y)
    }
    lastKind.current = state.kind
  }, [state.kind, copy])

  return { state, copy }
}
