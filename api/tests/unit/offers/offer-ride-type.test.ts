import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))
vi.mock('@/modules/offers/offers.repository', () => ({ findActiveOffers: vi.fn(), getOfferByCode: vi.fn(), getUserUsage: vi.fn() }))
vi.mock('@/modules/rides/rides.repository', () => ({ getCityBillingMode: vi.fn() }))
vi.mock('@/modules/pricing/pricing.service', () => ({ getFareEstimate: vi.fn() }))

import { pool } from '@/db/client'
import { getConfigValue } from '@/lib/system-config'
import { findActiveOffers, getUserUsage, type OfferRecord } from '@/modules/offers/offers.repository'
import { getCityBillingMode } from '@/modules/rides/rides.repository'
import { evaluateOffers, type PreviewInput } from '@/modules/offers/offers.service'
import { evaluateRules } from '@/modules/offers/engine'
import { ruleSchema } from '@/modules/offers/offers.schemas'
import { offerRideType } from '@/modules/offers/offer-ride-type'
import { previewSchema } from '@/modules/offers/offers.controller'
import { simulateSchema } from '@/modules/offers/admin-offers.service'
import type { FareEstimateResponse } from '@/modules/pricing/pricing.types'
import type { Rule } from '@/modules/offers/offers.types'

const estimate = (): FareEstimateResponse => ({
  pricing_version: 1, rate_card_id: 1, surge_event_id: null, surge_multiplier: 1, charge_per_stop: 0,
  breakdown: { base_fare: 400, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 0, total: 400 },
} as FareEstimateResponse)
const BASE: PreviewInput = { category_id: 1, ride_type: 'one_way', distance_km: 12, duration_min: 30, city_id: 1, paymentChannel: 'online' }
const offerFor = (types: string[]): OfferRecord => ({
  id: 1n, code: null, name: 'Test', kind: 'auto', status: 'active', versionId: 100n, version: 1,
  rules: [{ kind: 'ride_type', types } as unknown as Rule], benefit: { type: 'percent_off', percent: 10 }, perUserLimit: null,
  stacking: 'exclusive', fundedBy: 'driver', display: {}, budgetTotal: null, budgetSpent: 0, globalLimit: null, redemptionCount: 0, startsAt: null, endsAt: null,
}) as OfferRecord

describe('offerRideType', () => {
  it('is "city" only for a one-way city ride', () => {
    expect(offerRideType('one_way', 'city')).toBe('city')
  })
  it('is the ride type itself for everything else, including an old request with no trip mode', () => {
    expect(offerRideType('one_way', 'standard')).toBe('one_way')
    expect(offerRideType('one_way')).toBe('one_way')
    expect(offerRideType('round_trip')).toBe('round_trip')
    expect(offerRideType('rental', 'standard')).toBe('rental')
    expect(offerRideType('rental', 'city' as never)).toBe('rental')
  })
})

describe('the ride_type rule knows "city"', () => {
  const ctx = (rideType: string) => ({
    now: new Date(), user: { id: 1n, completedRides: 0, createdAt: new Date(0) },
    ride: { rideType, categoryId: 1, cityId: 1, originCityId: 1, destinationCityId: 1, paymentChannel: 'online', scheduledFor: null },
    fare: { base: 400, distance: 0, time: 0, stop: 0, hourSurcharge: 0, waiting: 0, surge: 0, overage: 0 },
  }) as never
  it('accepts a stored rule that lists city and matches only a city ride', () => {
    const rule = ruleSchema.parse({ kind: 'ride_type', types: ['city'] })
    expect(evaluateRules([rule], ctx('city'))).toEqual({ ok: true })
    expect(evaluateRules([rule], ctx('one_way'))).toEqual({ ok: false, reason: 'RIDE_TYPE' })
  })
  it('a one-way rule no longer matches a city ride (offers are separate per mode)', () => {
    const rule = ruleSchema.parse({ kind: 'ride_type', types: ['one_way'] })
    expect(evaluateRules([rule], ctx('city'))).toEqual({ ok: false, reason: 'RIDE_TYPE' })
  })
})

describe('evaluateOffers: the preview and the booking see the same ride type', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const config: Record<string, string> = { offers_enabled: 'true', commission_percent: '0', offers_cash_discounts_enabled: 'false', cash_collection_enabled: 'true', offers_cashback_enabled: 'false', offers_max_discount_percent: '15' }
    vi.mocked(getConfigValue).mockImplementation(async (k: string, fb: string) => config[k] ?? fb)
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ n: '0' }], rowCount: 1 } as never)
    vi.mocked(getUserUsage).mockResolvedValue(new Map())
    vi.mocked(getCityBillingMode).mockResolvedValue('commission')
  })

  it('a one-way offer applies to a standard one-way ride, as before (no trip mode sent)', async () => {
    vi.mocked(findActiveOffers).mockResolvedValue([offerFor(['one_way'])])
    expect((await evaluateOffers(7n, BASE, estimate())).result.applied).not.toBeNull()
  })

  it('a one-way offer does not apply to a city ride, and a city offer does', async () => {
    vi.mocked(findActiveOffers).mockResolvedValue([offerFor(['one_way'])])
    expect((await evaluateOffers(7n, { ...BASE, trip_mode: 'city' }, estimate())).result.applied).toBeNull()
    vi.mocked(findActiveOffers).mockResolvedValue([offerFor(['city'])])
    expect((await evaluateOffers(7n, { ...BASE, trip_mode: 'city' }, estimate())).result.applied).not.toBeNull()
    expect((await evaluateOffers(7n, BASE, estimate())).result.applied).toBeNull()
  })
})

describe('request schemas', () => {
  it('the offers preview accepts trip_mode (zod would otherwise strip it and the preview would disagree with the booking)', () => {
    const parsed = previewSchema.parse({ category_id: 1, ride_type: 'one_way', distance_km: 5, duration_min: 10, paymentChannel: 'cash', trip_mode: 'city' })
    expect(parsed.trip_mode).toBe('city')
    expect(previewSchema.safeParse({ category_id: 1, ride_type: 'one_way', distance_km: 5, duration_min: 10, paymentChannel: 'cash', trip_mode: 'bogus' }).success).toBe(false)
  })
  it('the admin simulator can test a city ride', () => {
    const parsed = simulateSchema.parse({ fare: {}, ride: { rideType: 'city' } })
    expect(parsed.ride.rideType).toBe('city')
  })
})
