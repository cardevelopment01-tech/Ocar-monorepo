import { z } from 'zod'
import { pool } from '@/db/client'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { recordAuditLog } from '@/lib/audit-log'
import { getConfigValue } from '@/lib/system-config'
import { benefitCatalog, benefitSchema, ruleSchema } from './offers.schemas'
import { computeBenefit, describeOffer, evaluateRules } from './engine'
import { ruleCatalog } from './rules'
import { reasonMessage } from './offers.service'
import * as repo from './offers.repository'
import type { Benefit, EvalContext, FareComponents } from './offers.types'

const VALIDATION = AppErrors.VALIDATION_ERROR.code
const NOT_FOUND = AppErrors.NOT_FOUND

/** Zod failure -> 422 whose message names the path ("rules.0.amount: ..."), never a 500. */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const r = schema.safeParse(body)
  if (!r.success) {
    const i = r.error.issues[0]!
    throw httpError(422, `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`, VALIDATION)
  }
  return r.data
}

const isoOrNull = z.string().datetime({ offset: true }).nullable().optional()
const versionFields = {
  rules: z.array(ruleSchema).max(20).default([]),
  benefit: benefitSchema,
  perUserLimit: z.number().int().positive().nullable().default(null),
  stacking: z.enum(['exclusive', 'stackable']).default('exclusive'),
  display: z.record(z.unknown()).default({}),
}

export const createOfferSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['code', 'auto', 'assigned']),
  code: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_-]+$/, 'letters, numbers, - and _ only').nullable().optional(),
  status: z.enum(['draft', 'active']).default('draft'),
  budgetTotal: z.number().nonnegative().nullable().default(null),
  globalLimit: z.number().int().positive().nullable().default(null),
  startsAt: isoOrNull,
  endsAt: isoOrNull,
  ...versionFields,
}).refine((o) => !o.startsAt || !o.endsAt || Date.parse(o.endsAt) > Date.parse(o.startsAt), { message: 'must be after startsAt', path: ['endsAt'] })
export const versionSchema = z.object(versionFields)

/** A first-ride rule only sees COMPLETED rides, so a rider could book several before the first completes. The per-user limit is
 *  atomic, so a first-ride offer defaults to it: 1 for new_user, n for first_n_rides (an admin may set it lower, never unset). */
export function withFirstRideLimit<T extends { rules: { kind: string; n?: unknown }[]; perUserLimit: number | null }>(v: T): T {
  let cap: number | null = null
  for (const r of v.rules) {
    if (r.kind === 'new_user') cap = Math.min(cap ?? 1, 1)
    if (r.kind === 'first_n_rides' && typeof r.n === 'number') cap = Math.min(cap ?? r.n, r.n)
  }
  if (cap == null) return v
  return { ...v, perUserLimit: v.perUserLimit == null ? cap : Math.min(v.perUserLimit, cap) }
}
export const patchOfferSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
  endsAt: isoOrNull,
  budgetTotal: z.number().nonnegative().nullable().optional(),
  globalLimit: z.number().int().positive().nullable().optional(),
  display: z.record(z.unknown()).optional(),
}).strict()

const TRANSITIONS: Record<string, string[]> = { draft: ['active', 'ended'], active: ['paused', 'ended'], paused: ['active', 'ended'], ended: [] }

/** Cashback is off until riders can spend wallet credit; a discount may not exceed the driver-safe cap (D23). */
async function assertBenefitAllowed(benefit: Benefit, rules: { kind: string; amount?: unknown }[] = []): Promise<void> {
  if (benefit.type === 'cashback_percent' || benefit.type === 'cashback_flat') {
    if ((await getConfigValue('offers_cashback_enabled', 'false')) !== 'true') {
      throw httpError(422, 'Cashback offers are not enabled yet', 'CASHBACK_DISABLED')
    }
    return
  }
  if (benefit.type === 'percent_off') {
    const cap = parseFloat(await getConfigValue('offers_max_discount_percent', '15'))
    if (benefit.percent > cap) throw httpError(422, `Discount cannot be more than ${cap}% of the fare`, 'DISCOUNT_TOO_HIGH')
  }
  if (benefit.type === 'flat_off') {
    // A flat amount is a different share of every fare, so it needs a minimum fare that keeps it under the cap; otherwise the
    // engine would clamp it silently and the offer text would promise more than riders get.
    const cap = parseFloat(await getConfigValue('offers_max_discount_percent', '15'))
    const minFare = rules.find((r) => r.kind === 'min_fare')?.amount
    const needed = Math.ceil((benefit.amount * 100) / (Number.isFinite(cap) && cap > 0 ? cap : 15))
    if (typeof minFare !== 'number' || minFare < needed) {
      throw httpError(422, `₹${benefit.amount} off needs a minimum fare of at least ₹${needed} to stay within ${cap}% of the fare`, 'DISCOUNT_TOO_HIGH')
    }
  }
}

export async function meta() {
  const [cashback, cashDiscounts, cashCollection, cap] = await Promise.all([
    getConfigValue('offers_cashback_enabled', 'false'),
    getConfigValue('offers_cash_discounts_enabled', 'false'),
    getConfigValue('cash_collection_enabled', 'true'),
    getConfigValue('offers_max_discount_percent', '15'),
  ])
  return {
    rules: ruleCatalog(),
    benefits: benefitCatalog(),
    // A cash offer with cash discounts off would never apply, so the form must not let admins build one.
    capabilities: { cashback: cashback === 'true', cashDiscounts: cashDiscounts === 'true' && cashCollection === 'true', maxDiscountPercent: parseFloat(cap) },
  }
}

const withSummary = (row: repo.AdminOfferRow) => ({
  ...row,
  summary: row.summary_benefit ? describeOffer({ rules: row.summary_rules ?? [], benefit: row.summary_benefit }) : null,
})

export async function listOffers(q: { status?: string; search?: string; limit: number; offset: number }) {
  return (await repo.listOffersAdmin(q)).map(withSummary)
}

export async function getOffer(id: bigint) {
  const r = await repo.getOfferAdmin(id)
  if (!r) throw httpError(NOT_FOUND.httpStatus, NOT_FOUND.message, NOT_FOUND.code)
  return { ...withSummary(r.offer), versions: r.versions }
}

async function tx<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally { c.release() }
}

export async function createOffer(adminId: bigint, body: unknown, ip: string | null) {
  const b = withFirstRideLimit(parseOrThrow(createOfferSchema, body))
  if (b.kind === 'code' && !b.code) throw httpError(422, 'code: a code offer needs a code', VALIDATION)
  if (b.kind === 'auto' && b.code) throw httpError(422, 'code: an automatic offer has no code', VALIDATION)
  await assertBenefitAllowed(b.benefit, b.rules)
  const code = b.code ? repo.normalizeCode(b.code) : null
  let created: { offerId: bigint; versionId: bigint }
  try {
    created = await tx((c) => repo.createOfferTx(c, adminId, {
      name: b.name, kind: b.kind, code, status: b.status, budgetTotal: b.budgetTotal, globalLimit: b.globalLimit,
      startsAt: b.startsAt ?? null, endsAt: b.endsAt ?? null,
      rules: b.rules, benefit: b.benefit, perUserLimit: b.perUserLimit, stacking: b.stacking, display: b.display,
    }))
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw httpError(409, 'That code is already used', 'CODE_TAKEN')
    throw e
  }
  await repo.invalidateOffers(code)
  await recordAuditLog({ adminId, action: 'offer.create', targetTable: 'offers', targetId: created.offerId, afterState: { name: b.name, kind: b.kind, code }, ipAddress: ip })
  return getOffer(created.offerId)
}

export async function createVersion(adminId: bigint, offerId: bigint, body: unknown, ip: string | null) {
  const b = withFirstRideLimit(parseOrThrow(versionSchema, body))
  await assertBenefitAllowed(b.benefit, b.rules)
  const out = await tx(async (c) => {
    const cur = await repo.lockOfferForUpdate(c, offerId)
    if (!cur) return null
    const v = await repo.createVersionTx(c, adminId, offerId, b)
    return { v, code: cur.code }
  })
  if (!out || !out.v) throw httpError(NOT_FOUND.httpStatus, NOT_FOUND.message, NOT_FOUND.code)
  await repo.invalidateOffers(out.code)
  await recordAuditLog({ adminId, action: 'offer.version', targetTable: 'offers', targetId: offerId, afterState: { version: out.v.version }, ipAddress: ip })
  return getOffer(offerId)
}

export async function patchOffer(adminId: bigint, offerId: bigint, body: unknown, ip: string | null) {
  const p = parseOrThrow(patchOfferSchema, body)
  const patch: repo.OfferPatch = {}
  if (p.name !== undefined) patch.name = p.name
  if (p.status !== undefined) patch.status = p.status
  if (p.endsAt !== undefined) patch.endsAt = p.endsAt
  if (p.budgetTotal !== undefined) patch.budgetTotal = p.budgetTotal
  if (p.globalLimit !== undefined) patch.globalLimit = p.globalLimit
  if (p.display !== undefined) patch.display = p.display
  const result = await tx(async (c) => {
    const cur = await repo.lockOfferForUpdate(c, offerId)
    if (!cur) return null
    if (p.status !== undefined && p.status !== cur.status && !(TRANSITIONS[cur.status] ?? []).includes(p.status)) {
      throw httpError(422, `An offer that is ${cur.status} cannot become ${p.status}`, 'INVALID_TRANSITION')
    }
    if (p.budgetTotal != null && p.budgetTotal < parseFloat(cur.budget_spent)) {
      throw httpError(422, 'The budget cannot be below what has already been spent', 'BUDGET_BELOW_SPENT')
    }
    if (p.endsAt && cur.starts_at && Date.parse(p.endsAt) <= cur.starts_at.getTime()) {
      throw httpError(422, 'endsAt: must be after the start', VALIDATION)
    }
    if (p.budgetTotal !== undefined && cur.status === 'active' && cur.budget_total != null &&
        (p.budgetTotal === null ? false : p.budgetTotal < parseFloat(cur.budget_total))) {
      throw httpError(422, 'The budget of a live offer can only go up', 'BUDGET_DECREASE')
    }
    await repo.patchOfferTx(c, offerId, patch)
    return { code: cur.code, from: cur.status }
  })
  if (!result) throw httpError(NOT_FOUND.httpStatus, NOT_FOUND.message, NOT_FOUND.code)
  await repo.invalidateOffers(result.code)
  const statusChanged = p.status !== undefined && p.status !== result.from
  await recordAuditLog({
    adminId, action: statusChanged ? 'offer.status' : 'offer.update', targetTable: 'offers', targetId: offerId,
    beforeState: { status: result.from }, afterState: { ...patch } as Record<string, unknown>, ipAddress: ip,
  })
  return getOffer(offerId)
}

export async function stats(offerId: bigint) {
  const offer = await getOffer(offerId)
  const rows = await repo.offerStats(offerId)
  const by = Object.fromEntries(rows.map((r) => [r.status, r]))
  const live = (by['reserved']?.discount ?? 0) + (by['consumed']?.discount ?? 0)
  return {
    offerId: String(offerId),
    redemptions: Object.fromEntries(rows.map((r) => [r.status, r.n])),
    discountGiven: live,
    cashbackGiven: (by['reserved']?.cashback ?? 0) + (by['consumed']?.cashback ?? 0),
    budgetTotal: offer.budget_total == null ? null : parseFloat(offer.budget_total),
    budgetSpent: parseFloat(offer.budget_spent),
  }
}

export async function redemptions(offerId: bigint, limit: number, offset: number) {
  return repo.listRedemptions(offerId, limit, offset)
}

const fareField = z.number().nonnegative().default(0)
export const simulateSchema = z.object({
  fare: z.object({ base: fareField, distance: fareField, time: fareField, stop: fareField, hourSurcharge: fareField, waiting: fareField, surge: fareField, overage: fareField }),
  ride: z.object({
    rideType: z.enum(['one_way', 'round_trip', 'rental']).default('one_way'),
    categoryId: z.number().int().default(0), cityId: z.number().int().nullable().default(null),
    originCityId: z.number().int().nullable().default(null), destinationCityId: z.number().int().nullable().default(null),
    paymentChannel: z.enum(['cash', 'online', 'wallet']).default('online'), scheduledFor: z.string().datetime({ offset: true }).nullable().default(null),
  }),
  completedRides: z.number().int().nonnegative().default(0),
  now: z.string().datetime({ offset: true }).optional(),
})

/** What this offer's current version would do for a sample ride. Rules and benefit only: flags and limits are live concerns. */
export async function simulate(offerId: bigint, body: unknown) {
  const s = parseOrThrow(simulateSchema, body)
  const offer = await getOffer(offerId)
  const cur = offer.versions[0]
  if (!cur) throw httpError(NOT_FOUND.httpStatus, NOT_FOUND.message, NOT_FOUND.code)
  const ctx: EvalContext = {
    now: s.now ? new Date(s.now) : new Date(),
    user: { id: 0n, completedRides: s.completedRides, createdAt: new Date(0) },
    ride: { ...s.ride, scheduledFor: s.ride.scheduledFor ? new Date(s.ride.scheduledFor) : null },
    fare: s.fare as FareComponents,
  }
  const rules = evaluateRules(cur.rules, ctx)
  const cap = parseFloat(await getConfigValue('offers_max_discount_percent', '15'))
  const benefit = rules.ok ? computeBenefit(cur.benefit, ctx.fare, cap) : { discount: 0, cashback: 0 }
  return {
    eligible: rules.ok, reason: rules.ok ? null : rules.reason, message: rules.ok ? null : reasonMessage(rules.reason, rules.detail),
    ...benefit, summary: describeOffer({ rules: cur.rules, benefit: cur.benefit }),
  }
}
