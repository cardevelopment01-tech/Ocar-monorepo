import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))
vi.mock('@/modules/offers/offers.repository', () => ({ findActiveOffers: vi.fn(), getOfferByCode: vi.fn(), getUserUsage: vi.fn() }))
vi.mock('@/modules/rides/rides.repository', () => ({ getCityBillingMode: vi.fn() }))
vi.mock('@/modules/pricing/pricing.service', () => ({ getFareEstimate: vi.fn() }))

import { pool } from '@/db/client'
import { getConfigValue } from '@/lib/system-config'
import { findActiveOffers, getOfferByCode, getUserUsage, type OfferRecord } from '@/modules/offers/offers.repository'
import { getCityBillingMode } from '@/modules/rides/rides.repository'
import { evaluateOffers, reasonMessage, type PreviewInput } from '@/modules/offers/offers.service'
import type { FareEstimateResponse } from '@/modules/pricing/pricing.types'
import type { Benefit, ReasonCode, Rule } from '@/modules/offers/offers.types'

let config: Record<string, string>
const estimate = (base = 400, surge = 54): FareEstimateResponse => ({
  pricing_version: 1, rate_card_id: 1, surge_event_id: null, surge_multiplier: 1.135, charge_per_stop: 0,
  breakdown: { base_fare: base, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: surge, total: base + surge },
} as FareEstimateResponse)
const input: PreviewInput = { category_id: 1, ride_type: 'one_way', distance_km: 62, duration_min: 90, city_id: 1, paymentChannel: 'online' }

let nextId = 1n
const offer = (o: Partial<OfferRecord> & { benefit?: Benefit; rules?: Rule[] } = {}): OfferRecord => ({
  id: nextId++, code: null, name: 'Test offer', kind: 'auto', status: 'active', versionId: 100n, version: 1, rules: [],
  benefit: { type: 'percent_off', percent: 10 }, perUserLimit: null, stacking: 'exclusive', fundedBy: 'driver', display: {},
  budgetTotal: null, budgetSpent: 0, globalLimit: null, redemptionCount: 0, startsAt: null, endsAt: null, ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  nextId = 1n
  config = { offers_enabled: 'true', commission_percent: '0', offers_cash_discounts_enabled: 'false', cash_collection_enabled: 'true', offers_cashback_enabled: 'false', offers_max_discount_percent: '15' }
  vi.mocked(getConfigValue).mockImplementation(async (k: string, fb: string) => config[k] ?? fb)
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ n: '0' }], rowCount: 1 } as never)
  vi.mocked(findActiveOffers).mockResolvedValue([])
  vi.mocked(getOfferByCode).mockResolvedValue(null)
  vi.mocked(getUserUsage).mockResolvedValue(new Map())
  vi.mocked(getCityBillingMode).mockResolvedValue('commission')
})

const run = (i: Partial<PreviewInput> = {}) => evaluateOffers(7n, { ...input, ...i }, estimate())

describe('evaluateOffers', () => {
  it('does nothing while offers_enabled is false', async () => {
    config['offers_enabled'] = 'false'
    vi.mocked(findActiveOffers).mockResolvedValue([offer()])
    const { result } = await run({ code: 'SAVE50' })
    expect(result.applied).toBeNull()
    expect(result.rejected).toEqual([])
    expect(result.payable).toBe(454)
    expect(findActiveOffers).not.toHaveBeenCalled()
  })

  it('applies an auto offer on the discountable components only and reports a summary', async () => {
    vi.mocked(findActiveOffers).mockResolvedValue([offer({ benefit: { type: 'percent_off', percent: 10 } })])
    const { result } = await run()
    expect(result.discount).toBe(40) // 10% of 400, surge excluded
    expect(result.payable).toBe(414)
    expect(result.applied?.summary).toBe('10% off')
  })

  it('a typed code that fails a rule is rejected with a message naming what is needed', async () => {
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'SAVE50', kind: 'code', rules: [{ kind: 'min_fare', amount: 500 }] }))
    const { result } = await run({ code: 'SAVE50' })
    expect(result.applied).toBeNull()
    expect(result.rejected[0]).toMatchObject({ code: 'SAVE50', reason: 'MIN_FARE', message: 'Add ₹46 more to use this offer' })
  })

  it('an unknown code is UNKNOWN_CODE', async () => {
    const { result } = await run({ code: 'NOPE' })
    expect(result.rejected).toEqual([{ code: 'NOPE', reason: 'UNKNOWN_CODE', message: "That code isn't valid" }])
  })

  it('a typed code beats an auto offer even when the auto offer is larger', async () => {
    vi.mocked(findActiveOffers).mockResolvedValue([offer({ benefit: { type: 'percent_off', percent: 15 } })])
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'SAVE5', kind: 'code', benefit: { type: 'percent_off', percent: 5 } }))
    const { result } = await run({ code: 'SAVE5' })
    expect(result.applied?.code).toBe('SAVE5')
    expect(result.alternatives).toHaveLength(1)
  })

  it('among auto offers the larger rider value wins and a tie goes to the earlier end', async () => {
    const soon = new Date(Date.now() + 86_400_000)
    const later = new Date(Date.now() + 5 * 86_400_000)
    vi.mocked(findActiveOffers).mockResolvedValue([
      offer({ name: 'later', benefit: { type: 'flat_off', amount: 40 }, endsAt: later }),
      offer({ name: 'sooner', benefit: { type: 'flat_off', amount: 40 }, endsAt: soon }),
      offer({ name: 'small', benefit: { type: 'flat_off', amount: 10 } }),
    ])
    const { result } = await run()
    expect(result.applied?.name).toBe('sooner')
    expect(result.alternatives.map((a) => a.name)).toEqual(['later', 'small'])
  })

  it('discount offers need the commission holiday: rejected while commission_percent is above 0 (D19/COMMISSION_ACTIVE)', async () => {
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'X1', kind: 'code' }))
    config['commission_percent'] = '15'
    expect((await run({ code: 'X1' })).result.rejected[0]).toMatchObject({ reason: 'COMMISSION_ACTIVE', message: "This offer isn't available right now" })
    config['commission_percent'] = '0'
    expect((await run({ code: 'X1' })).result.applied).not.toBeNull()
  })

  it('package-billing cities get no discount offers (NOT_COMMISSION_CITY); commission cities do', async () => {
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'X2', kind: 'code' }))
    vi.mocked(getCityBillingMode).mockResolvedValue('package')
    expect((await run({ code: 'X2' })).result.rejected[0]?.reason).toBe('NOT_COMMISSION_CITY')
    vi.mocked(getCityBillingMode).mockResolvedValue('commission')
    expect((await run({ code: 'X2' })).result.applied).not.toBeNull()
  })

  it('cash discounts need offers_cash_discounts_enabled AND cash_collection_enabled', async () => {
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'X3', kind: 'code' }))
    expect((await run({ code: 'X3', paymentChannel: 'cash' })).result.rejected[0]?.reason).toBe('PAYMENT_CHANNEL')
    config['offers_cash_discounts_enabled'] = 'true'
    expect((await run({ code: 'X3', paymentChannel: 'cash' })).result.applied).not.toBeNull()
    config['cash_collection_enabled'] = 'false'
    expect((await run({ code: 'X3', paymentChannel: 'cash' })).result.rejected[0]?.reason).toBe('PAYMENT_CHANNEL')
  })

  it('a cashback offer is DISABLED until offers_cashback_enabled, then applies even on cash', async () => {
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'CB', kind: 'code', benefit: { type: 'cashback_percent', percent: 10, expiresInDays: 30 } }))
    expect((await run({ code: 'CB', paymentChannel: 'cash' })).result.rejected[0]?.reason).toBe('DISABLED')
    config['offers_cashback_enabled'] = 'true'
    const { result } = await run({ code: 'CB', paymentChannel: 'cash' })
    expect(result.cashback).toBe(40)
    expect(result.discount).toBe(0)
    expect(result.payable).toBe(454)
  })

  it('respects the maximum-discount cap', async () => {
    vi.mocked(findActiveOffers).mockResolvedValue([offer({ benefit: { type: 'flat_off', amount: 300 } })])
    expect((await run()).result.discount).toBe(60) // 15% of the 400 eligible
  })

  it('an unparseable cap falls back to 15, and an offer with nothing to give is not blamed on the minimum fare', async () => {
    config['offers_max_discount_percent'] = 'abc'
    vi.mocked(findActiveOffers).mockResolvedValue([offer({ benefit: { type: 'flat_off', amount: 300 } })])
    expect((await run()).result.discount).toBe(60)
    config['offers_max_discount_percent'] = '0'
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'ZERO', kind: 'code' }))
    expect((await run({ code: 'ZERO' })).result.rejected[0]?.reason).toBe('DISABLED')
  })

  it('does not count rides unless a first-ride rule is present', async () => {
    vi.mocked(findActiveOffers).mockResolvedValue([offer()])
    await run()
    expect(pool.query).not.toHaveBeenCalled()
    vi.mocked(findActiveOffers).mockResolvedValue([offer({ rules: [{ kind: 'new_user' }] })])
    await run()
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it("a rider who removed the automatic offer gets none, and one who picked an offer gets that one, not the best", async () => {
    const big = offer({ name: 'big', benefit: { type: 'flat_off', amount: 60 } })
    const small = offer({ name: 'small', benefit: { type: 'flat_off', amount: 10 } })
    vi.mocked(findActiveOffers).mockResolvedValue([big, small])
    expect((await run()).result.applied?.name).toBe('big')
    expect((await run({ autoOffer: 'none' })).result.applied).toBeNull()
    expect((await run({ autoOffer: small.id.toString() })).result.applied?.name).toBe('small')
    expect((await run({ autoOffer: '999' })).result.applied).toBeNull()
  })

  it('lists an automatic offer the rider is a little short of as ineligible with how much more, but not other misses', async () => {
    vi.mocked(findActiveOffers).mockResolvedValue([
      offer({ name: 'needs 500', rules: [{ kind: 'min_fare', amount: 500 }] }),
      offer({ name: 'cash only', rules: [{ kind: 'payment_channel', channels: ['cash'] }] }),
    ])
    const { result } = await run()
    expect(result.ineligible).toEqual([expect.objectContaining({ name: 'needs 500', message: 'Add ₹46 more to use this offer' })])
    expect(result.rejected).toEqual([])
  })

  it('rejects when the per-user limit, global limit or budget is used up (preview-time check)', async () => {
    const o = offer({ code: 'L1', kind: 'code', perUserLimit: 1 })
    vi.mocked(getOfferByCode).mockResolvedValue(o)
    vi.mocked(getUserUsage).mockResolvedValue(new Map([[o.id, 1]]))
    expect((await run({ code: 'L1' })).result.rejected[0]?.reason).toBe('USER_LIMIT')
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'L2', kind: 'code', globalLimit: 3, redemptionCount: 3 }))
    expect((await run({ code: 'L2' })).result.rejected[0]?.reason).toBe('GLOBAL_LIMIT')
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'L3', kind: 'code', budgetTotal: 100, budgetSpent: 80 }))
    expect((await run({ code: 'L3' })).result.rejected[0]?.reason).toBe('BUDGET')
  })

  it('an assigned offer typed by a rider it was not granted to is NOT_ASSIGNED', async () => {
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'GIFT', kind: 'assigned' }))
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    expect((await run({ code: 'GIFT' })).result.rejected[0]?.reason).toBe('NOT_ASSIGNED')
  })

  it('a paused offer, one not yet started and an expired one are explained', async () => {
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'P1', kind: 'code', status: 'paused' }))
    expect((await run({ code: 'P1' })).result.rejected[0]?.reason).toBe('DISABLED')
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'P2', kind: 'code', startsAt: new Date(Date.now() + 3600_000) }))
    expect((await run({ code: 'P2' })).result.rejected[0]?.reason).toBe('NOT_STARTED')
    vi.mocked(getOfferByCode).mockResolvedValue(offer({ code: 'P3', kind: 'code', endsAt: new Date(Date.now() - 3600_000) }))
    expect((await run({ code: 'P3' })).result.rejected[0]?.reason).toBe('EXPIRED')
  })
})

describe('reasonMessage', () => {
  it('has a non-empty rider-facing message for every reason code', () => {
    const all: ReasonCode[] = ['DISABLED', 'NOT_STARTED', 'EXPIRED', 'MIN_FARE', 'RIDE_TYPE', 'CATEGORY', 'CITY', 'ROUTE', 'PAYMENT_CHANNEL', 'NEW_USERS_ONLY', 'FIRST_N_RIDES', 'SCHEDULE', 'USER_LIMIT', 'GLOBAL_LIMIT', 'BUDGET', 'NOT_ASSIGNED', 'UNKNOWN_CODE', 'COMMISSION_ACTIVE', 'NOT_COMMISSION_CITY']
    for (const r of all) expect(reasonMessage(r).length).toBeGreaterThan(5)
  })
})
