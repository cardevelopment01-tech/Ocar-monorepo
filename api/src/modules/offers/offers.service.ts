import { pool } from '@/db/client'
import { getConfigValue } from '@/lib/system-config'
import { getFareEstimate } from '@/modules/pricing/pricing.service'
import type { FareEstimateRequest, FareEstimateResponse } from '@/modules/pricing/pricing.types'
import { getCityBillingMode } from '@/modules/rides/rides.repository'
import { computeBenefit, describeOffer, evaluateRules } from './engine'
import { findActiveOffers, getOfferByCode, getUserUsage, type OfferRecord } from './offers.repository'
import type { EvalContext, FareComponents, PaymentChannel, ReasonCode } from './offers.types'
import { roundPaise, sumComponents } from './money'

export type PreviewInput = FareEstimateRequest & {
  code?: string
  paymentChannel: PaymentChannel
  scheduledFor?: string
  originCityId?: number | null
  destinationCityId?: number | null
}

export type AppliedOffer = {
  offerId: string
  versionId: string
  code: string | null
  name: string
  kind: OfferRecord['kind']
  /** One plain line from describeOffer; the only offer wording clients show. */
  summary: string
  discount: number
  cashback: number
}

export type Rejection = { offerId?: string; code?: string; reason: ReasonCode; message: string }

export type PreviewResult = {
  fareTotal: number
  discount: number
  cashback: number
  payable: number
  applied: AppliedOffer | null
  alternatives: AppliedOffer[]
  rejected: Rejection[]
}

/** The single source of rider-facing reason copy. */
export function reasonMessage(reason: ReasonCode, detail?: Record<string, number | string>): string {
  switch (reason) {
    case 'MIN_FARE': return detail?.['needed'] != null ? `Add ₹${detail['needed']} more to use this offer` : 'The fare is too low for this offer'
    case 'UNKNOWN_CODE': return "That code isn't valid"
    case 'EXPIRED': return 'This offer has ended'
    case 'NOT_STARTED': return "This offer hasn't started yet"
    case 'RIDE_TYPE': return "This offer doesn't apply to this type of ride"
    case 'CATEGORY': return "This offer doesn't apply to this vehicle"
    case 'CITY': return "This offer isn't available in your city"
    case 'ROUTE': return "This offer doesn't apply to this route"
    case 'PAYMENT_CHANNEL': return "This offer isn't available for this payment method"
    case 'NEW_USERS_ONLY': return 'This offer is for new riders only'
    case 'FIRST_N_RIDES': return 'This offer was for your first rides'
    case 'SCHEDULE': return "This offer isn't valid at this time"
    case 'USER_LIMIT': return "You've already used this offer"
    case 'GLOBAL_LIMIT': case 'BUDGET': return 'This offer is fully claimed'
    case 'NOT_ASSIGNED': return "This offer isn't on your account"
    case 'DISABLED': case 'COMMISSION_ACTIVE': case 'NOT_COMMISSION_CITY': return "This offer isn't available right now"
  }
}

function components(b: FareEstimateResponse['breakdown']): FareComponents {
  return {
    base: b.base_fare, distance: b.distance_fare, time: b.time_fare, stop: b.stop_fare, hourSurcharge: b.hour_surcharge,
    waiting: b.waiting_fare ?? 0, surge: b.surge_fare, overage: b.overage_fare,
  }
}

const isDiscount = (o: OfferRecord) => o.benefit.type === 'percent_off' || o.benefit.type === 'flat_off'

async function completedRides(userId: bigint): Promise<number> {
  const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM rides WHERE user_id = $1 AND status = 'completed'`, [userId])
  return Number(r.rows[0]?.n ?? 0)
}

async function isAssignedTo(userId: bigint, offerId: bigint): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM user_offers WHERE user_id = $1 AND offer_id = $2 AND status = 'available' AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`,
    [userId, offerId]
  )
  return (r.rowCount ?? 0) > 0
}

export type Evaluation = { chosen: AppliedOffer | null; result: PreviewResult }

/** The full decision for one quote: what applies, what else could, and why the rest does not. Never trusts client amounts. */
export async function evaluateOffers(userId: bigint, input: PreviewInput, estimate: FareEstimateResponse): Promise<Evaluation> {
  const fare = components(estimate.breakdown)
  const fareTotal = roundPaise(sumComponents(fare))
  const empty: PreviewResult = { fareTotal, discount: 0, cashback: 0, payable: fareTotal, applied: null, alternatives: [], rejected: [] }

  if ((await getConfigValue('offers_enabled', 'false')) !== 'true') return { chosen: null, result: empty }

  const [commissionPct, cashDiscounts, cashCollection, cashbackOn, maxPctRaw] = await Promise.all([
    getConfigValue('commission_percent', '15'),
    getConfigValue('offers_cash_discounts_enabled', 'false'),
    getConfigValue('cash_collection_enabled', 'true'),
    getConfigValue('offers_cashback_enabled', 'false'),
    getConfigValue('offers_max_discount_percent', '15'),
  ])
  const commissionActive = parseFloat(commissionPct) > 0
  const maxPct = parseFloat(maxPctRaw)
  const cityId = input.city_id ?? input.originCityId ?? null
  const packageCity = cityId != null && (await getCityBillingMode(BigInt(cityId))) === 'package'

  const code = input.code?.trim()
  const rejected: Rejection[] = []
  const candidates: OfferRecord[] = []
  let typedOffer: OfferRecord | null = null

  if (code) {
    typedOffer = await getOfferByCode(code)
    if (!typedOffer) rejected.push({ code, reason: 'UNKNOWN_CODE', message: reasonMessage('UNKNOWN_CODE') })
    else if (typedOffer.kind === 'assigned' && !(await isAssignedTo(userId, typedOffer.id))) {
      rejected.push({ offerId: typedOffer.id.toString(), code, reason: 'NOT_ASSIGNED', message: reasonMessage('NOT_ASSIGNED') })
      typedOffer = null
    } else candidates.push(typedOffer)
  }
  for (const o of await findActiveOffers()) if (o.kind === 'auto' && o.id !== typedOffer?.id) candidates.push(o)
  if (candidates.length === 0) return { chosen: null, result: { ...empty, rejected } }

  const usage = await getUserUsage(userId, candidates.map((c) => c.id))
  const ctx: EvalContext = {
    now: new Date(),
    user: { id: userId, completedRides: await completedRides(userId), createdAt: new Date(0) },
    ride: {
      rideType: input.ride_type, categoryId: input.category_id, cityId: input.city_id ?? null,
      originCityId: input.originCityId ?? null, destinationCityId: input.destinationCityId ?? null,
      paymentChannel: input.paymentChannel, scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
    },
    fare,
  }

  const eligible: AppliedOffer[] = []
  const toApplied = (o: OfferRecord, discount: number, cashback: number): AppliedOffer => ({
    offerId: o.id.toString(), versionId: o.versionId.toString(), code: o.code, name: o.name, kind: o.kind,
    summary: describeOffer({ rules: o.rules, benefit: o.benefit, per_user_limit: o.perUserLimit }), discount, cashback,
  })
  const reject = (o: OfferRecord, reason: ReasonCode, detail?: Record<string, number | string>) => {
    // Only the offer the rider typed is explained; auto offers that do not fit are simply not shown.
    if (o.id === typedOffer?.id) rejected.push({ offerId: o.id.toString(), ...(o.code ? { code: o.code } : {}), reason, message: reasonMessage(reason, detail) })
  }

  for (const o of candidates) {
    if (o.status !== 'active') { reject(o, 'DISABLED'); continue }
    if (o.startsAt && o.startsAt > ctx.now) { reject(o, 'NOT_STARTED'); continue }
    if (o.endsAt && o.endsAt <= ctx.now) { reject(o, 'EXPIRED'); continue }
    if (isDiscount(o)) {
      if (commissionActive) { reject(o, 'COMMISSION_ACTIVE'); continue }
      if (packageCity) { reject(o, 'NOT_COMMISSION_CITY'); continue }
      if (input.paymentChannel === 'cash' && (cashDiscounts !== 'true' || cashCollection !== 'true')) { reject(o, 'PAYMENT_CHANNEL'); continue }
    } else if (cashbackOn !== 'true') { reject(o, 'DISABLED'); continue }
    const rules = evaluateRules(o.rules, ctx)
    if (!rules.ok) { reject(o, rules.reason, rules.detail); continue }
    if (o.perUserLimit != null && (usage.get(o.id) ?? 0) >= o.perUserLimit) { reject(o, 'USER_LIMIT'); continue }
    if (o.globalLimit != null && o.redemptionCount >= o.globalLimit) { reject(o, 'GLOBAL_LIMIT'); continue }
    const { discount, cashback } = computeBenefit(o.benefit, fare, maxPct)
    if (discount + cashback <= 0) { reject(o, 'MIN_FARE'); continue }
    if (o.budgetTotal != null && o.budgetSpent + discount + cashback > o.budgetTotal) { reject(o, 'BUDGET'); continue }
    eligible.push(toApplied(o, discount, cashback))
  }

  // Typed code beats auto offers; otherwise the larger rider value wins and a tie goes to the offer that ends first.
  const endsAt = new Map(candidates.map((c) => [c.id.toString(), c.endsAt?.getTime() ?? Infinity]))
  eligible.sort((a, b) => {
    const typedA = a.offerId === typedOffer?.id.toString() ? 1 : 0
    const typedB = b.offerId === typedOffer?.id.toString() ? 1 : 0
    return typedB - typedA || (b.discount + b.cashback) - (a.discount + a.cashback) || (endsAt.get(a.offerId)! - endsAt.get(b.offerId)!)
  })
  const chosen = eligible[0] ?? null
  return {
    chosen,
    result: {
      fareTotal, discount: chosen?.discount ?? 0, cashback: chosen?.cashback ?? 0,
      payable: roundPaise(Math.max(fareTotal - (chosen?.discount ?? 0), 0)),
      applied: chosen, alternatives: eligible.slice(1), rejected,
    },
  }
}

export async function previewOffers(userId: bigint, input: PreviewInput): Promise<PreviewResult> {
  const estimate = await getFareEstimate(input)
  return (await evaluateOffers(userId, input, estimate)).result
}

/** Same decision, from the estimate createBooking already computed, so the discount matches the stored fare exactly. */
export async function resolveForBooking(userId: bigint, input: PreviewInput, estimate: FareEstimateResponse): Promise<Evaluation> {
  return evaluateOffers(userId, input, estimate)
}
