import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { evaluateRules, computeBenefit, describeOffer } from '@/modules/offers/engine'
import { ruleSchema, benefitSchema } from '@/modules/offers/offers.schemas'
import { registerRule, ruleCatalog } from '@/modules/offers/rules'
import type { EvalContext, FareComponents } from '@/modules/offers/offers.types'

const fare = (o: Partial<FareComponents> = {}): FareComponents => ({
  base: 0, distance: 0, time: 0, stop: 0, hourSurcharge: 0, waiting: 0, surge: 0, overage: 0, ...o,
})
const MON_10AM_IST = new Date('2026-11-02T04:30:00Z')
const ctx = (o: { fare?: FareComponents; now?: Date; completedRides?: number; ride?: Partial<EvalContext['ride']> } = {}): EvalContext => ({
  now: o.now ?? MON_10AM_IST,
  user: { id: 1n, completedRides: o.completedRides ?? 0, createdAt: new Date('2026-10-01T00:00:00Z') },
  ride: {
    rideType: 'one_way', categoryId: 1, cityId: 1, originCityId: 1, destinationCityId: 2, paymentChannel: 'online', scheduledFor: null,
    ...o.ride,
  },
  fare: o.fare ?? fare({ base: 454 }),
})

describe('ruleSchema', () => {
  it('rejects an unknown rule kind with a path, never throws', () => {
    const r = ruleSchema.safeParse({ kind: 'moon_phase' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['kind'])
  })
  it('rejects bad config and fills defaults', () => {
    expect(ruleSchema.safeParse({ kind: 'min_fare', amount: -5 }).success).toBe(false)
    const s = ruleSchema.parse({ kind: 'schedule', weekdays: [0] })
    expect(s).toMatchObject({ kind: 'schedule', evaluateAt: 'booking' })
  })
})

describe('evaluateRules', () => {
  it('passes with no rules and requires every rule', () => {
    expect(evaluateRules([], ctx())).toEqual({ ok: true })
    const rules = [ruleSchema.parse({ kind: 'ride_type', types: ['one_way'] }), ruleSchema.parse({ kind: 'category', categoryIds: [9] })]
    expect(evaluateRules(rules, ctx())).toEqual({ ok: false, reason: 'CATEGORY' })
  })
  it('returns the first failing rule, and fails closed on an unknown kind', () => {
    const rules = [ruleSchema.parse({ kind: 'city', cityIds: [7] }), ruleSchema.parse({ kind: 'category', categoryIds: [9] })]
    expect(evaluateRules(rules, ctx())).toEqual({ ok: false, reason: 'CITY' })
    expect(evaluateRules([{ kind: 'gone' }], ctx())).toEqual({ ok: false, reason: 'DISABLED' })
  })
})

describe('rules', () => {
  const run = (rule: object, c: EvalContext = ctx()) => evaluateRules([ruleSchema.parse(rule)], c)

  it('min_fare names the shortfall', () => {
    expect(run({ kind: 'min_fare', amount: 500 })).toEqual({ ok: false, reason: 'MIN_FARE', detail: { needed: 46 } })
    expect(run({ kind: 'min_fare', amount: 454 })).toEqual({ ok: true })
  })
  it('new_user and first_n_rides use completed rides', () => {
    expect(run({ kind: 'new_user' }, ctx({ completedRides: 1 }))).toEqual({ ok: false, reason: 'NEW_USERS_ONLY' })
    expect(run({ kind: 'new_user' })).toEqual({ ok: true })
    expect(run({ kind: 'first_n_rides', n: 3 }, ctx({ completedRides: 3 }))).toEqual({ ok: false, reason: 'FIRST_N_RIDES' })
    expect(run({ kind: 'first_n_rides', n: 3 }, ctx({ completedRides: 2 }))).toEqual({ ok: true })
  })
  it('ride_type, payment_channel, city and route', () => {
    expect(run({ kind: 'ride_type', types: ['rental'] })).toEqual({ ok: false, reason: 'RIDE_TYPE' })
    expect(run({ kind: 'payment_channel', channels: ['cash'] })).toEqual({ ok: false, reason: 'PAYMENT_CHANNEL' })
    expect(run({ kind: 'city', cityIds: [1] })).toEqual({ ok: true })
    expect(run({ kind: 'city', cityIds: [1] }, ctx({ ride: { cityId: null } }))).toEqual({ ok: false, reason: 'CITY' })
    const route = { kind: 'route', pairs: [{ originCityId: 2, destinationCityId: 1 }] }
    expect(run(route)).toEqual({ ok: false, reason: 'ROUTE' })
    expect(run({ ...route, bothDirections: true })).toEqual({ ok: true })
  })
  it('schedule: a Sunday-only window fails on a Monday in India time', () => {
    expect(run({ kind: 'schedule', weekdays: [0] })).toEqual({ ok: false, reason: 'SCHEDULE' })
    expect(run({ kind: 'schedule', weekdays: [1] })).toEqual({ ok: true })
  })
  it('schedule: judged by booking time or ride time', () => {
    const sundayRide = new Date('2026-11-01T05:00:00Z')
    const c = ctx({ ride: { scheduledFor: sundayRide } })
    expect(run({ kind: 'schedule', weekdays: [0] }, c)).toEqual({ ok: false, reason: 'SCHEDULE' })
    expect(run({ kind: 'schedule', weekdays: [0], evaluateAt: 'ride' }, c)).toEqual({ ok: true })
    expect(run({ kind: 'schedule', weekdays: [1], evaluateAt: 'ride' }, c)).toEqual({ ok: false, reason: 'SCHEDULE' })
  })
  it('schedule: 23:59 and 00:00 India time fall on different days', () => {
    const before = ctx({ now: new Date('2026-11-01T18:29:00Z') }) // Sunday 23:59 IST
    const after = ctx({ now: new Date('2026-11-01T18:30:00Z') })  // Monday 00:00 IST
    expect(run({ kind: 'schedule', weekdays: [0] }, before)).toEqual({ ok: true })
    expect(run({ kind: 'schedule', weekdays: [0] }, after)).toEqual({ ok: false, reason: 'SCHEDULE' })
    expect(run({ kind: 'schedule', hours: { from: 10, to: 21 }, startDate: '2026-11-02', endDate: '2026-11-02' })).toEqual({ ok: true })
    expect(run({ kind: 'schedule', endDate: '2026-11-01' })).toEqual({ ok: false, reason: 'SCHEDULE' })
  })
})

describe('computeBenefit', () => {
  it('percent_off 20 max 100: surge is excluded by default and the max caps it', () => {
    expect(computeBenefit(benefitSchema.parse({ type: 'percent_off', percent: 20, maxDiscount: 100 }), fare({ base: 400, surge: 60 })).discount).toBe(80)
    expect(computeBenefit(benefitSchema.parse({ type: 'percent_off', percent: 20, maxDiscount: 100 }), fare({ base: 1000 })).discount).toBe(100)
  })
  it('flat_off never exceeds the eligible total, and a zero fare gives zero', () => {
    expect(computeBenefit({ type: 'flat_off', amount: 500 }, fare({ base: 300 })).discount).toBe(300)
    expect(computeBenefit({ type: 'percent_off', percent: 50 }, fare()).discount).toBe(0)
  })
  it('appliesTo can include surge', () => {
    expect(computeBenefit({ type: 'percent_off', percent: 10, appliesTo: ['base', 'surge'] }, fare({ base: 400, surge: 60 })).discount).toBe(46)
  })
  it('cashback is returned as cashback, not a discount', () => {
    expect(computeBenefit({ type: 'cashback_percent', percent: 10, expiresInDays: 30 }, fare({ base: 400 }))).toEqual({ discount: 0, cashback: 40 })
    expect(computeBenefit({ type: 'cashback_flat', amount: 25, expiresInDays: 30 }, fare({ base: 400 }))).toEqual({ discount: 0, cashback: 25 })
  })
  it('rounds to paise without the 33.335 float trap', () => {
    expect(computeBenefit({ type: 'flat_off', amount: 33.335 }, fare({ base: 100 })).discount).toBe(33.34)
    expect(computeBenefit({ type: 'percent_off', percent: 33.335 }, fare({ base: 100 })).discount).toBe(33.34)
  })
  it('clamps a discount to the maximum percent of the eligible fare (driver-funded cap)', () => {
    expect(computeBenefit({ type: 'flat_off', amount: 100 }, fare({ base: 400 }), 15).discount).toBe(60)
    expect(computeBenefit({ type: 'percent_off', percent: 20 }, fare({ base: 400 }), 15).discount).toBe(60)
    expect(computeBenefit({ type: 'percent_off', percent: 10 }, fare({ base: 400 }), 15).discount).toBe(40)
  })
  it('a minimum-fare ride whose components sum below the billed fare still honours the cap', () => {
    // components sum to 300 although the billed fare was lifted to a 454 minimum: the cap uses the components
    expect(computeBenefit({ type: 'percent_off', percent: 50 }, fare({ base: 300 }), 15).discount).toBe(45)
  })
})

describe('describeOffer and the catalog', () => {
  it('renders the plain-English line', () => {
    const rules = [ruleSchema.parse({ kind: 'category', categoryIds: [1, 2] }), ruleSchema.parse({ kind: 'new_user' })]
    expect(describeOffer({ rules, benefit: { type: 'percent_off', percent: 20, maxDiscount: 100 } }, { category: { '1': 'Sedan', '2': 'SUV' } }))
      .toBe('20% off, max ₹100, Sedan/SUV, new users')
  })
  it('lists all nine kinds with labels and fields', () => {
    const cat = ruleCatalog()
    const kinds = cat.map((c) => c.kind).sort()
    expect(kinds).toEqual(['category', 'city', 'first_n_rides', 'min_fare', 'new_user', 'payment_channel', 'ride_type', 'route', 'schedule'])
    for (const c of cat) expect(c.label.length).toBeGreaterThan(0)
    expect(cat.find((c) => c.kind === 'schedule')?.fields.length).toBeGreaterThan(0)
  })
  it('a tenth kind registered with one call appears everywhere with no other edit', () => {
    const undo = registerRule({
      kind: 'test_only', label: 'Test only', fields: [{ key: 'x', type: 'number', label: 'X' }],
      schema: z.object({ kind: z.literal('test_only'), x: z.number() }),
      evaluate: (c, cx) => (cx.fare.base > c.x ? { ok: true } : { ok: false, reason: 'MIN_FARE' }),
      describe: (c) => `test over ${c.x}`,
    })
    try {
      expect(ruleCatalog().some((c) => c.kind === 'test_only')).toBe(true)
      const rule = ruleSchema.parse({ kind: 'test_only', x: 100 })
      expect(evaluateRules([rule], ctx())).toEqual({ ok: true })
      expect(describeOffer({ rules: [rule], benefit: { type: 'flat_off', amount: 10 } })).toBe('₹10 off, test over 100')
    } finally { undo() }
    expect(ruleCatalog().some((c) => c.kind === 'test_only')).toBe(false)
  })
})
