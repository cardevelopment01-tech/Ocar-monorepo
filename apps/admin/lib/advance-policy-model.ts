// The advance-booking policy as the Dispatch desk shows it. `lateCancelFee` mirrors api/src/lib/advance-policy.ts exactly so the example an
// admin sees while editing is the amount a rider will really be charged; both sides have tests built on the same cases.

export type LateFeeMode = 'percent' | 'flat'

export interface AdvancePolicy {
  lateCancelEnabled: boolean
  lateCancelWindowMin: number
  feeMode: LateFeeMode
  feePercent: number
  feeCap: number
  feeFlat: number
  rescheduleMax: number
  searchGraceMin: number
}

export type PolicyLimits = Record<keyof AdvancePolicy, { min: number | null; max: number | null }>

export function lateCancelFee(p: AdvancePolicy, fare: number): number {
  if (!p.lateCancelEnabled) return 0
  let amount = p.feeMode === 'flat' ? p.feeFlat : (fare * p.feePercent) / 100
  if (p.feeMode === 'percent' && p.feeCap > 0) amount = Math.min(amount, p.feeCap)
  return Math.round(Math.min(Math.max(amount, 0), Math.max(fare, 0)) * 100) / 100
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** "1 hour", "45 minutes", "1 hour 30 minutes" */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`
  const h = Math.floor(min / 60); const m = min % 60
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`
}

/** One sentence that shows the rule on a real fare, or says there is no fee. */
export function feeExample(p: AdvancePolicy, fare = 1850): string {
  if (!p.lateCancelEnabled) return 'No fee. Riders can cancel an advance booking until the driver arrives without paying.'
  const fee = lateCancelFee(p, fare)
  const how = p.feeMode === 'flat'
    ? `a flat ${inr(p.feeFlat)}`
    : `${p.feePercent}% of the fare${p.feeCap > 0 ? `, up to ${inr(p.feeCap)}` : ''}`
  return `On a ${inr(fare)} fare, cancelling within ${fmtMinutes(p.lateCancelWindowMin)} of pickup after a driver has accepted costs ${inr(fee)} (${how}). Cancelling earlier, or before a driver accepts, is free.`
}

export function samePolicy(a: AdvancePolicy, b: AdvancePolicy): boolean {
  return (Object.keys(a) as Array<keyof AdvancePolicy>).every(k => a[k] === b[k])
}

/** Only the fields that differ, which is exactly what the API takes. */
export function policyChanges(saved: AdvancePolicy, draft: AdvancePolicy): Partial<AdvancePolicy> {
  const out: Partial<AdvancePolicy> = {}
  for (const k of Object.keys(draft) as Array<keyof AdvancePolicy>) if (draft[k] !== saved[k]) (out as Record<string, unknown>)[k] = draft[k]
  return out
}

/** Why a draft cannot be saved, or null. Mirrors the API's bounds so the form says so before the server does. */
export function policyProblem(p: AdvancePolicy, limits: PolicyLimits | null): string | null {
  if (!limits) return null
  const numeric: Array<[keyof AdvancePolicy, string, boolean]> = [
    ['lateCancelWindowMin', 'The window', true], ['feePercent', 'The percentage', false], ['feeCap', 'The cap', false],
    ['feeFlat', 'The flat fee', false], ['rescheduleMax', 'The reschedule limit', true], ['searchGraceMin', 'The search time', true],
  ]
  for (const [k, label, whole] of numeric) {
    const v = p[k] as number
    const { min, max } = limits[k]
    if (!Number.isFinite(v)) return `${label} must be a number.`
    if (whole && !Number.isInteger(v)) return `${label} must be a whole number.`
    if (min !== null && v < min) return `${label} cannot be below ${min}.`
    if (max !== null && v > max) return `${label} cannot be above ${max}.`
  }
  return null
}
