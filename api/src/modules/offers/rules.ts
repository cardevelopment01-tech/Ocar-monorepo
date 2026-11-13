import { z } from 'zod'
import type { EvalContext, NameLookup, ReasonCode, Rule, RuleCatalogEntry, RuleDef, RuleResult } from './offers.types'
import { roundPaise, sumComponents } from './money'

// ── IST helpers (one place, shared by every time rule) ───────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const IST = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false,
})

/** Calendar date (YYYY-MM-DD), weekday (0 = Sunday) and hour (0-23) in India time. */
export function istParts(d: Date): { date: string; weekday: number; hour: number } {
  const p = Object.fromEntries(IST.formatToParts(d).map((x) => [x.type, x.value]))
  return {
    date: `${p['year']}-${p['month']}-${p['day']}`,
    weekday: WEEKDAY_INDEX[p['weekday'] ?? 'Sun'] ?? 0,
    hour: Number(p['hour']) % 24,
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY = new Map<string, RuleDef<any>>()

/** Add a rule kind. Returns an unregister function (used by tests). Adding a kind is this one call. */
export function registerRule<T>(def: RuleDef<T>): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  REGISTRY.set(def.kind, def as RuleDef<any>)
  return () => { REGISTRY.delete(def.kind) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRuleDef(kind: string): RuleDef<any> | undefined {
  return REGISTRY.get(kind)
}

export function ruleCatalog(): RuleCatalogEntry[] {
  return [...REGISTRY.values()].map((d) => ({ kind: d.kind, label: d.label, fields: d.fields }))
}

const ok: RuleResult = { ok: true }
function fail(reason: ReasonCode, detail?: Record<string, number | string>): RuleResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason }
}

const idList = z.array(z.number().int().positive()).min(1)
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

// ── The nine Phase 1 rules ───────────────────────────────────────────────────

registerRule({
  kind: 'ride_type',
  label: 'Ride type',
  fields: [{ key: 'types', type: 'multi', label: 'Ride types', options: [
    { value: 'one_way', label: 'One way' }, { value: 'round_trip', label: 'Round trip' }, { value: 'rental', label: 'Rental' }, { value: 'city', label: 'City ride' },
  ] }],
  schema: z.object({ kind: z.literal('ride_type'), types: z.array(z.enum(['one_way', 'round_trip', 'rental', 'city'])).min(1) }),
  evaluate: (c, ctx) => (c.types.includes(ctx.ride.rideType) ? ok : fail('RIDE_TYPE')),
  describe: (c) => c.types.map((t) => t.replace('_', ' ')).join('/'),
})

registerRule({
  kind: 'category',
  label: 'Vehicle category',
  fields: [{ key: 'categoryIds', type: 'multi', label: 'Categories' }],
  schema: z.object({ kind: z.literal('category'), categoryIds: idList }),
  evaluate: (c, ctx) => (c.categoryIds.includes(ctx.ride.categoryId) ? ok : fail('CATEGORY')),
  describe: (c, n?: NameLookup) => {
    const names = c.categoryIds.map((id) => n?.category?.[String(id)])
    return names.every(Boolean) ? names.join('/') : count(c.categoryIds.length, 'category').replace('categorys', 'categories')
  },
})

registerRule({
  kind: 'city',
  label: 'City',
  fields: [{ key: 'cityIds', type: 'multi', label: 'Cities' }],
  schema: z.object({ kind: z.literal('city'), cityIds: idList }),
  evaluate: (c, ctx) => (ctx.ride.cityId != null && c.cityIds.includes(ctx.ride.cityId) ? ok : fail('CITY')),
  describe: (c, n?: NameLookup) => {
    const names = c.cityIds.map((id) => n?.city?.[String(id)])
    return names.every(Boolean) ? `in ${names.join('/')}` : `in ${count(c.cityIds.length, 'city').replace('citys', 'cities')}`
  },
})

registerRule({
  kind: 'route',
  label: 'Route',
  fields: [
    { key: 'pairs', type: 'multi', label: 'Origin and destination cities' },
    { key: 'bothDirections', type: 'enum', label: 'Both directions', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  ],
  schema: z.object({
    kind: z.literal('route'),
    pairs: z.array(z.object({ originCityId: z.number().int().positive(), destinationCityId: z.number().int().positive() })).min(1),
    bothDirections: z.boolean().default(false),
  }),
  evaluate: (c, ctx) => {
    const { originCityId: o, destinationCityId: d } = ctx.ride
    if (o == null || d == null) return fail('ROUTE')
    const hit = c.pairs.some((p) => (p.originCityId === o && p.destinationCityId === d) || (c.bothDirections && p.originCityId === d && p.destinationCityId === o))
    return hit ? ok : fail('ROUTE')
  },
  describe: (c) => count(c.pairs.length, 'route'),
})

registerRule({
  kind: 'payment_channel',
  label: 'Payment method',
  fields: [{ key: 'channels', type: 'multi', label: 'Payment methods', options: [
    { value: 'cash', label: 'Cash' }, { value: 'online', label: 'Online' }, { value: 'wallet', label: 'Wallet' },
  ] }],
  schema: z.object({ kind: z.literal('payment_channel'), channels: z.array(z.enum(['cash', 'online', 'wallet'])).min(1) }),
  evaluate: (c, ctx) => (c.channels.includes(ctx.ride.paymentChannel) ? ok : fail('PAYMENT_CHANNEL')),
  describe: (c) => `pay by ${c.channels.join('/')}`,
})

registerRule({
  kind: 'min_fare',
  label: 'Minimum fare',
  fields: [{ key: 'amount', type: 'number', label: 'Minimum fare (₹)' }],
  schema: z.object({ kind: z.literal('min_fare'), amount: z.number().positive() }),
  evaluate: (c, ctx) => {
    const total = sumComponents(ctx.fare)
    return total >= c.amount ? ok : fail('MIN_FARE', { needed: roundPaise(c.amount - total) })
  },
  describe: (c) => `fare ₹${c.amount} or more`,
})

registerRule({
  kind: 'new_user',
  label: 'New riders only',
  fields: [],
  schema: z.object({ kind: z.literal('new_user') }),
  evaluate: (_c, ctx) => (ctx.user.completedRides === 0 ? ok : fail('NEW_USERS_ONLY')),
  describe: () => 'new users',
})

registerRule({
  kind: 'first_n_rides',
  label: 'First rides',
  fields: [{ key: 'n', type: 'number', label: 'Number of rides' }],
  schema: z.object({ kind: z.literal('first_n_rides'), n: z.number().int().min(1) }),
  evaluate: (c, ctx) => (ctx.user.completedRides < c.n ? ok : fail('FIRST_N_RIDES')),
  describe: (c) => `first ${count(c.n, 'ride')}`,
})

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
registerRule({
  kind: 'schedule',
  label: 'Dates, days and hours',
  fields: [
    { key: 'dates', type: 'dateRange', label: 'Dates (India time)' },
    { key: 'weekdays', type: 'multi', label: 'Days of the week', options: WEEKDAYS.map((d, i) => ({ value: String(i), label: d })) },
    { key: 'hours', type: 'hours', label: 'Hours of the day' },
    { key: 'evaluateAt', type: 'enum', label: 'Judge by', options: [{ value: 'booking', label: 'Booking time' }, { value: 'ride', label: 'Ride time' }] },
  ],
  schema: z.object({
    kind: z.literal('schedule'),
    startDate: ymd.optional(),
    endDate: ymd.optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
    hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) }).refine((h) => h.to > h.from).optional(),
    evaluateAt: z.enum(['booking', 'ride']).default('booking'),
  }).refine((c) => !c.startDate || !c.endDate || c.startDate <= c.endDate, { message: 'startDate must not be after endDate', path: ['endDate'] }),
  evaluate: (c, ctx) => {
    const at = c.evaluateAt === 'ride' && ctx.ride.scheduledFor ? ctx.ride.scheduledFor : ctx.now
    const p = istParts(at)
    if (c.startDate && p.date < c.startDate) return fail('SCHEDULE')
    if (c.endDate && p.date > c.endDate) return fail('SCHEDULE')
    if (c.weekdays && !c.weekdays.includes(p.weekday)) return fail('SCHEDULE')
    if (c.hours && !(p.hour >= c.hours.from && p.hour < c.hours.to)) return fail('SCHEDULE')
    return ok
  },
  describe: (c) => {
    const parts: string[] = []
    if (c.weekdays) parts.push(c.weekdays.map((d) => WEEKDAYS[d]?.slice(0, 3)).join('/'))
    if (c.hours) parts.push(`${c.hours.from}:00 to ${c.hours.to}:00`)
    if (c.startDate || c.endDate) parts.push(`${c.startDate ?? '...'} to ${c.endDate ?? '...'}`)
    return parts.join(', ') || 'any time'
  },
})

export type { Rule, EvalContext }
