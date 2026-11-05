import { describe, it, expect } from 'vitest'
import type { OfferDetail, OffersMeta, Redemption } from '../offers-api'
import {
  istNextDayStart, TEMPLATES, budgetUsedPercent, draftFromOffer, emptyDraft, groupCatalog, publishChecklist, redemptionsCsv, termsChanged, toPayload, validateDraft,
  type Draft,
} from '../offers-model'

// Value: protects=the rules an admin sees come from the server catalog (a new kind appears with no code change), bad
// drafts are caught before the server round trip, the flat-discount minimum-fare rule matches the API, and a draft
// survives the trip to the API and back; fails_when=a group/validation rule drifts from the API; why_new=PR3 form logic;
// seam=none; no_claim=the rendering (page tests) and the server's own validation.

const META: OffersMeta = {
  rules: [
    { kind: 'new_user', label: 'New riders only', fields: [] },
    { kind: 'first_n_rides', label: 'First rides', fields: [{ key: 'n', type: 'number', label: 'Number of rides' }] },
    { kind: 'city', label: 'City', fields: [{ key: 'cityIds', type: 'multi', label: 'Cities' }] },
    { kind: 'min_fare', label: 'Minimum fare', fields: [{ key: 'amount', type: 'number', label: 'Minimum fare (₹)' }] },
    { kind: 'schedule', label: 'Dates, days and hours', fields: [{ key: 'dates', type: 'dateRange', label: 'Dates' }] },
  ],
  benefits: [],
  capabilities: { cashback: false, cashDiscounts: false, maxDiscountPercent: 15 },
}
const draft = (o: Partial<Draft> = {}): Draft => ({ ...emptyDraft(), name: 'Ten off', code: 'TEN10', percent: '10', ...o })

describe('groupCatalog', () => {
  it('puts each catalog kind in its plain-language group, and a kind no group names under Other', () => {
    const withTenth = { ...META, rules: [...META.rules, { kind: 'moon_phase', label: 'Moon phase', fields: [] }] }
    const groups = groupCatalog(withTenth)
    expect(groups.map((g) => g.group.id)).toEqual(['who', 'where', 'what', 'when', 'other'])
    expect(groups.find((g) => g.group.id === 'who')!.kinds.map((k) => k.kind)).toEqual(['new_user', 'first_n_rides'])
    expect(groups.find((g) => g.group.id === 'other')!.kinds.map((k) => k.kind)).toEqual(['moon_phase'])
  })
  it('drops a group the server does not offer', () => {
    expect(groupCatalog({ ...META, rules: META.rules.filter((r) => r.kind !== 'city') }).map((g) => g.group.id)).not.toContain('where')
  })
})

describe('validateDraft', () => {
  it('accepts a simple valid draft', () => expect(validateDraft(draft(), META)).toEqual([]))

  it('catches name, code and percent problems', () => {
    expect(validateDraft(draft({ name: ' ' }), META)).toContain('Give the offer a name.')
    expect(validateDraft(draft({ code: '' }), META)).toContain('A code offer needs a code.')
    expect(validateDraft(draft({ code: 'has space' }), META)[0]).toMatch(/no spaces/)
    expect(validateDraft(draft({ kind: 'auto', code: '' }), META)).toEqual([])
    expect(validateDraft(draft({ percent: '' }), META)).toContain('Enter the percent off.')
    expect(validateDraft(draft({ percent: '150' }), META)).toContain('Percent off cannot be more than 100.')
    expect(validateDraft(draft({ percent: '20' }), META)[0]).toMatch(/more than 15%/)
  })

  it('a flat discount needs a minimum fare that keeps it within the cap (matches the API: 50 / 15% = 334)', () => {
    const flat = draft({ benefitType: 'flat_off', amount: '50' })
    expect(validateDraft(flat, META)[0]).toMatch(/minimum fare of at least ₹334/)
    expect(validateDraft({ ...flat, rules: [{ kind: 'min_fare', amount: 300 }] }, META)[0]).toMatch(/₹334/)
    expect(validateDraft({ ...flat, rules: [{ kind: 'min_fare', amount: 334 }] }, META)).toEqual([])
  })

  it('cashback is refused while the server says it is off', () => {
    const cb = draft({ benefitType: 'cashback_percent', percent: '5' })
    expect(validateDraft(cb, META)).toContain('Cashback offers are not switched on yet.')
    expect(validateDraft(cb, { ...META, capabilities: { ...META.capabilities, cashback: true } })).toEqual([])
  })

  it('checks each condition from its field spec', () => {
    expect(validateDraft(draft({ rules: [{ kind: 'min_fare', amount: -5 }] }), META)[0]).toMatch(/Minimum fare: enter minimum fare/i)
    expect(validateDraft(draft({ rules: [{ kind: 'first_n_rides', n: 0 }] }), META)[0]).toMatch(/First rides/)
    expect(validateDraft(draft({ rules: [{ kind: 'city', cityIds: [] }] }), META)[0]).toMatch(/choose at least one/)
    expect(validateDraft(draft({ rules: [{ kind: 'schedule' }] }), META)[0]).toMatch(/choose at least a date/)
    expect(validateDraft(draft({ rules: [{ kind: 'schedule', startDate: '2026-12-10', endDate: '2026-12-01' }] }), META)[0]).toMatch(/end date comes before/)
    expect(validateDraft(draft({ rules: [{ kind: 'schedule', hours: { from: 10, to: 9 } }] }), META)[0]).toMatch(/hours must end after/)
    expect(validateDraft(draft({ rules: [{ kind: 'unknown_kind' }] }), META)[0]).toMatch(/does not know/)
  })

  it('catches limits, budget and dates', () => {
    expect(validateDraft(draft({ perUserLimit: '0' }), META)[0]).toMatch(/Uses per rider/)
    expect(validateDraft(draft({ globalLimit: '1.5' }), META)[0]).toMatch(/Total uses/)
    expect(validateDraft(draft({ budgetTotal: '-1' }), META)).toContain('Budget cannot be negative.')
    expect(validateDraft(draft({ startsAt: '2026-12-02', endsAt: '2026-12-01' }), META)).toContain('The end date must be on or after the start date.')
  })
})

describe('toPayload and draftFromOffer', () => {
  it('builds the API body: upper-case trimmed code, numbers not strings, India-time dates, nulls for blanks', () => {
    const p = toPayload(draft({ code: ' ten10 ', maxDiscount: '50', budgetTotal: '5000', startsAt: '2026-12-01', endsAt: '2026-12-31', perUserLimit: '1' }), 'active')
    expect(p).toMatchObject({
      name: 'Ten off', kind: 'code', code: 'TEN10', status: 'active', perUserLimit: 1, budgetTotal: 5000, globalLimit: null,
      benefit: { type: 'percent_off', percent: 10, maxDiscount: 50 },
      startsAt: '2026-11-30T18:30:00.000Z', endsAt: '2026-12-31T18:29:59.000Z',
    })
  })
  it('an automatic offer sends no code', () => expect(toPayload(draft({ kind: 'auto', code: 'IGNORED' }), 'draft')).not.toHaveProperty('code'))

  it('round-trips through an offer detail', () => {
    const original = draft({ maxDiscount: '50', budgetTotal: '5000', startsAt: '2026-12-01', endsAt: '2026-12-31', perUserLimit: '1', rules: [{ kind: 'new_user' }] })
    const p = toPayload(original, 'draft')
    const detail = {
      id: '1', code: 'TEN10', name: p.name, kind: 'code', status: 'draft', version: 1, summary: null, budget_total: '5000.00', budget_spent: '0',
      global_limit: null, redemption_count: 0, starts_at: p.startsAt, ends_at: p.endsAt, created_at: '', updated_at: '',
      versions: [{ id: '9', version: 1, rules: p.rules, benefit: p.benefit, per_user_limit: p.perUserLimit, stacking: 'exclusive', display: {}, created_at: '' }],
    } as unknown as OfferDetail
    expect(draftFromOffer(detail)).toEqual(original)
  })

  it('termsChanged tells a terms edit (new version) from a name or budget edit (in place)', () => {
    const a = draft()
    expect(termsChanged(a, { ...a, name: 'Other', budgetTotal: '100', endsAt: '2027-01-01' })).toBe(false)
    expect(termsChanged(a, { ...a, percent: '12' })).toBe(true)
    expect(termsChanged(a, { ...a, rules: [{ kind: 'new_user' }] })).toBe(true)
    expect(termsChanged(a, { ...a, perUserLimit: '2' })).toBe(true)
  })
})

describe('templates', () => {
  it('every starting template is a valid draft once a code is added (and blank is not)', () => {
    for (const t of TEMPLATES) {
      const errs = validateDraft(t.apply({ ...emptyDraft(), code: 'TMPL10' }), META)
      if (t.id === 'blank') expect(errs.length, t.id).toBeGreaterThan(0)
      else expect(errs, t.id).toEqual([])
    }
  })
})

describe('publishChecklist', () => {
  it('warns about a missing budget, end date and per-rider limit, and about cash while cash discounts are off', () => {
    const items = Object.fromEntries(publishChecklist(draft(), META).map((i) => [i.id, i]))
    expect(items['budget']!.ok).toBe(false)
    expect(items['end']!.ok).toBe(false)
    expect(items['limit']!.ok).toBe(false)
    expect(items['cash']!.ok).toBe(false)
    const ready = Object.fromEntries(publishChecklist(draft({ budgetTotal: '5000', endsAt: '2026-12-31', perUserLimit: '1', rules: [{ kind: 'payment_channel', channels: ['online'] }] }), META).map((i) => [i.id, i]))
    expect(Object.values(ready).every((i) => i.ok)).toBe(true)
  })
  it('a first-ride rule counts as a per-rider limit; cash is fine once cash discounts are on', () => {
    const on = { ...META, capabilities: { ...META.capabilities, cashDiscounts: true } }
    const items = Object.fromEntries(publishChecklist(draft({ rules: [{ kind: 'new_user' }] }), on).map((i) => [i.id, i]))
    expect(items['limit']!.ok).toBe(true)
    expect(items['cash']!.ok).toBe(true)
  })
})

describe('budgetUsedPercent and redemptionsCsv', () => {
  it('computes the used share, capped at 100, and null with no budget', () => {
    expect(budgetUsedPercent('410.00', '500.00')).toBe(82)
    expect(budgetUsedPercent(600, 500)).toBe(100)
    expect(budgetUsedPercent('10', null)).toBeNull()
    expect(budgetUsedPercent('10', '0')).toBeNull()
  })
  it('writes a header and one quoted line per row', () => {
    const rows = [{ id: '1', ride_id: '7', user_id: '3', status: 'consumed', discount_amount: '40.00', cashback_amount: '0.00', reserved_at: 'a', consumed_at: 'b', released_at: null, reason: 'said "hi", ok' }] as Redemption[]
    const csv = redemptionsCsv(rows).split('\n')
    expect(csv[0]).toBe('Redemption,Ride,Rider,Status,Discount,Cashback,Reserved at,Consumed at,Released at,Reason')
    expect(csv[1]).toBe('1,7,3,consumed,40.00,0.00,a,b,,"said ""hi"", ok"')
  })
})

describe('review hardening', () => {
  it("an unchanged existing offer is not re-judged against today's limits; changed terms are", () => {
    const old = draft({ percent: '15' })
    const tighter = { ...META, capabilities: { ...META.capabilities, maxDiscountPercent: 10 } }
    expect(validateDraft(old, tighter)[0]).toMatch(/more than 10%/)
    expect(validateDraft(old, tighter, { checkBenefit: false })).toEqual([])
    const cb = draft({ benefitType: 'cashback_percent', percent: '5' })
    expect(validateDraft(cb, META, { checkBenefit: false })).toEqual([])
    expect(validateDraft({ ...old, name: ' ' }, tighter, { checkBenefit: false })).toEqual(['Give the offer a name.'])
  })

  it('a route needs a from and a to city on every row', () => {
    const meta = { ...META, rules: [...META.rules, { kind: 'route', label: 'Route', fields: [{ key: 'pairs', type: 'multi' as const, label: 'Origin and destination cities' }] }] }
    const rule = (pairs: unknown[]) => draft({ rules: [{ kind: 'route', pairs }] })
    expect(validateDraft(rule([{ originCityId: 0, destinationCityId: 0 }]), meta)[0]).toMatch(/pick a from and a to city/)
    expect(validateDraft(rule([{ originCityId: 1, destinationCityId: 0 }]), meta)[0]).toMatch(/pick a from and a to city/)
    expect(validateDraft(rule([]), meta)[0]).toMatch(/pick a from and a to city/)
    expect(validateDraft(rule([{ originCityId: 1, destinationCityId: 2 }]), meta)).toEqual([])
  })

  it('an assigned offer keeps its kind and needs no code', () => {
    const d = draftFromOffer({ id: '1', code: null, name: 'Gift', kind: 'assigned', status: 'active', version: 1, summary: null, budget_total: null, budget_spent: '0',
      global_limit: null, redemption_count: 0, starts_at: null, ends_at: null, created_at: '', updated_at: '',
      versions: [{ id: '2', version: 1, rules: [], benefit: { type: 'percent_off', percent: 10 }, per_user_limit: null, stacking: 'exclusive', display: {}, created_at: '' }] } as unknown as OfferDetail)
    expect(d.kind).toBe('assigned')
    expect(validateDraft(d, META)).toEqual([])
  })

  it('"up to and including" a date means before the start of the next India-time day', () => {
    expect(istNextDayStart('2026-11-03')).toBe('2026-11-03T18:30:00.000Z')
  })
})
