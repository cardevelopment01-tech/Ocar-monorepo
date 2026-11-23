import { getConfigValue } from '@/lib/system-config'

// The rules an admin sets for advance bookings (Dispatch desk > Policy). They live in system_config, so every read is cached
// and a change takes effect within the cache TTL. This file is the one place that turns those settings into numbers.

export type LateFeeMode = 'percent' | 'flat'

export interface AdvancePolicy {
  lateCancelEnabled: boolean
  /** A cancellation this many minutes or fewer before pickup is late. */
  lateCancelWindowMin: number
  feeMode: LateFeeMode
  feePercent: number
  /** Most a percent-based fee can be; 0 means no cap. */
  feeCap: number
  feeFlat: number
  rescheduleMax: number
  /** Keep searching this long past the pickup time when dispatch found nobody; 0 gives up at once. */
  searchGraceMin: number
}

export const ADVANCE_POLICY_DEFAULTS: AdvancePolicy = {
  lateCancelEnabled: false, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10,
}

/** The config key behind each policy field, and its inclusive numeric bounds (mirrored in system-config-bounds.ts). */
export const POLICY_KEYS = {
  lateCancelEnabled:   { key: 'advance_late_cancel_enabled' },
  lateCancelWindowMin: { key: 'advance_late_cancel_window_min', min: 0, max: 1440, integer: true },
  feeMode:             { key: 'advance_late_cancel_fee_mode' },
  feePercent:          { key: 'advance_late_cancel_fee_percent', min: 0, max: 100 },
  feeCap:              { key: 'advance_late_cancel_fee_cap', min: 0, max: 5000 },
  feeFlat:             { key: 'advance_late_cancel_fee_flat', min: 0, max: 5000 },
  rescheduleMax:       { key: 'advance_reschedule_max', min: 0, max: 10, integer: true },
  searchGraceMin:      { key: 'advance_search_grace_min', min: 0, max: 60, integer: true },
} as const

const num = (raw: string, fallback: number): number => {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export async function getAdvancePolicy(): Promise<AdvancePolicy> {
  const d = ADVANCE_POLICY_DEFAULTS
  const [enabled, win, mode, pct, cap, flat, max, grace] = await Promise.all([
    getConfigValue(POLICY_KEYS.lateCancelEnabled.key, String(d.lateCancelEnabled)),
    getConfigValue(POLICY_KEYS.lateCancelWindowMin.key, String(d.lateCancelWindowMin)),
    getConfigValue(POLICY_KEYS.feeMode.key, d.feeMode),
    getConfigValue(POLICY_KEYS.feePercent.key, String(d.feePercent)),
    getConfigValue(POLICY_KEYS.feeCap.key, String(d.feeCap)),
    getConfigValue(POLICY_KEYS.feeFlat.key, String(d.feeFlat)),
    getConfigValue(POLICY_KEYS.rescheduleMax.key, String(d.rescheduleMax)),
    getConfigValue(POLICY_KEYS.searchGraceMin.key, String(d.searchGraceMin)),
  ])
  return {
    lateCancelEnabled: enabled === 'true',
    lateCancelWindowMin: num(win, d.lateCancelWindowMin),
    feeMode: mode === 'flat' ? 'flat' : 'percent',
    feePercent: num(pct, d.feePercent),
    feeCap: num(cap, d.feeCap),
    feeFlat: num(flat, d.feeFlat),
    rescheduleMax: num(max, d.rescheduleMax),
    searchGraceMin: num(grace, d.searchGraceMin),
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface LateFeeInput {
  /** The quoted fare in rupees; the fee is never more than this. */
  fare: number
  scheduledFor: Date
  now: Date
  /** Only a driver who accepted has been put out; before that nobody is owed anything. */
  driverAccepted: boolean
}

export interface LateFeeResult {
  /** Rupees to charge; 0 when no fee applies. */
  amount: number
  /** A late cancellation would cost money right now. */
  applies: boolean
  /** When the free period ends (pickup minus the window); null when the policy is off. */
  freeUntil: Date | null
}

/** What cancelling costs for one advance booking at one moment. Pure: no I/O, so the rider app, admin and tests all agree. */
export function lateCancelFee(policy: AdvancePolicy, input: LateFeeInput): LateFeeResult {
  if (!policy.lateCancelEnabled) return { amount: 0, applies: false, freeUntil: null }
  const freeUntil = new Date(input.scheduledFor.getTime() - policy.lateCancelWindowMin * 60_000)
  const late = input.now.getTime() >= freeUntil.getTime()
  if (!late || !input.driverAccepted) return { amount: 0, applies: false, freeUntil }
  let amount = policy.feeMode === 'flat' ? policy.feeFlat : (input.fare * policy.feePercent) / 100
  if (policy.feeMode === 'percent' && policy.feeCap > 0) amount = Math.min(amount, policy.feeCap)
  amount = round2(Math.min(Math.max(amount, 0), Math.max(input.fare, 0)))
  return { amount, applies: amount > 0, freeUntil }
}

/** The words shown to a rider before they commit, from the policy alone (no ride needed). Null when there is no fee to mention. */
export function lateCancelSummary(policy: AdvancePolicy): { windowMin: number; mode: LateFeeMode; percent: number; cap: number; flat: number } | null {
  if (!policy.lateCancelEnabled) return null
  return { windowMin: policy.lateCancelWindowMin, mode: policy.feeMode, percent: policy.feePercent, cap: policy.feeCap, flat: policy.feeFlat }
}
