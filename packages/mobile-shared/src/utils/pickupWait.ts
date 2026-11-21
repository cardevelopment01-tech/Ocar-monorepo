// The waiting clock at the pickup. One pure function decides which state the clock is in so the driver and rider phones can never
// disagree; the API sends `pickupWaitStartedAt` (the later of the driver's "arrived" tap and the first position recorded at the
// pickup), the free minutes and the rate, so no client hardcodes the billing rule. The apps never work out money: the charge is
// computed on the server and shown once, on the receipt.
//
// States, in order: none -> pending (driver tapped arrived but is not at the pickup yet) -> free (countdown) -> charging (count-up).
// The web rider app carries a copy of this file (apps/user/lib/pickupWait.ts) and runs the same cases.

import { formatClock } from './tripWindow'

export type PickupWaitState =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'free'; msLeft: number }
  | { kind: 'charging'; overMs: number }

export interface PickupWaitInput {
  status: string | null | undefined
  /** ISO time the wait started; absent while the driver has not really reached the pickup. */
  startedAt: string | null | undefined
  freeMin: number | null | undefined
  /** Server-corrected "now" in epoch ms (serverNow()), so a skewed phone clock cannot shift states. */
  now: number
}

export function pickupWait({ status, startedAt, freeMin, now }: PickupWaitInput): PickupWaitState {
  if (status !== 'driver_arrived' || freeMin == null) return { kind: 'none' }
  const startMs = startedAt ? new Date(startedAt).getTime() : NaN
  if (Number.isNaN(startMs)) return { kind: 'pending' }
  const endMs = startMs + freeMin * 60_000
  // At exactly the end of the free minutes the server still charges nothing, so free holds through that instant.
  if (now <= endMs) return { kind: 'free', msLeft: Math.max(0, endMs - now) }
  return { kind: 'charging', overMs: now - endMs }
}

export type PickupWaitAudience = 'driver' | 'rider'

export interface PickupWaitCopy {
  /** Feather icon name: the state is never colour-only. */
  icon: 'clock' | 'plus-circle' | 'map-pin'
  tone: 'neutral' | 'caution' | 'earn'
  label: string
  /** The running time ("2:41" counting down, "+1:20" counting up); absent while pending. */
  value?: string
  /** One quiet line: the fixed rate, never a running amount. */
  note?: string
  /** Full sentence for screen readers (focus and transition announcements). */
  a11y: string
}

/** "₹3 a minute": the unit riders compare against other apps. */
function perMinute(rate: number): string {
  return `₹${Number.isInteger(rate) ? rate : rate.toFixed(2)} a minute`
}

/**
 * Words for each state. The rider and the driver see the same time; only the framing differs. Nobody sees a running rupee amount:
 * the charge is added to the final fare and shown on the receipt.
 */
export function pickupWaitCopy(
  state: PickupWaitState,
  audience: PickupWaitAudience,
  opts: { perMin?: number | null },
): PickupWaitCopy | null {
  const rider = audience === 'rider'
  const rate = opts.perMin != null && opts.perMin > 0 ? perMinute(opts.perMin) : null

  switch (state.kind) {
    case 'none':
      return null
    case 'pending':
      // Only the driver can act on this; the rider has nothing to see until the driver is really at the pickup.
      return rider ? null : {
        icon: 'map-pin', tone: 'neutral',
        label: 'Waiting timer not started',
        note: 'Move closer to the pickup to start the free wait.',
        a11y: 'Waiting timer not started. Move closer to the pickup to start the free wait.',
      }
    case 'free': {
      const value = formatClock(state.msLeft)
      return {
        icon: 'clock', tone: 'neutral',
        label: rider ? 'Free waiting' : 'Free waiting left',
        value,
        // The start-code prompt already sits under the button, so this line only states what comes after the free minutes.
        ...(rate ? { note: rider ? `Then ${rate}.` : `Then ${rate} is added to the fare.` } : {}),
        a11y: `Free waiting, ${value} left.${rate ? ` Then ${rate}${rider ? '' : ' is added to the fare'}.` : ''}`,
      }
    }
    case 'charging': {
      const value = `+${formatClock(state.overMs)}`
      return {
        icon: 'plus-circle', tone: rider ? 'caution' : 'earn',
        label: 'Extra waiting',
        value,
        ...(rate ? { note: rider ? `${rate} applies. Added to your final fare.` : `${rate} is added to the fare.` } : {}),
        a11y: `Extra waiting ${value}.${rate ? ` ${rate}${rider ? ' applies' : ' is added to the fare'}.` : ''}`,
      }
    }
  }
}
