import { describe, it, expect, vi, beforeEach } from 'vitest'

const bookingClient = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() }))

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide: vi.fn(), insertFareSnapshot: vi.fn(), insertRideStops: vi.fn(), logStatusHistory: vi.fn(),
  createRideAssignment: vi.fn(), getActiveRideIdForUser: vi.fn(),
}))
vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours: vi.fn((_t: string, h: number | undefined) => h ?? 0),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(async () => bookingClient) } }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: {}, getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })) }))
// createBooking reads the dispatch switch; every config key here just returns its fallback (switch off).
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn(async (_k: string, fallback: string) => fallback) }))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn().mockResolvedValue(undefined) }, scheduler: { add: vi.fn().mockResolvedValue({ id: 'j' }) } },
  QUEUE_NAMES: { DISPATCH: 'dispatch', SCHEDULER: 'scheduler' },
  gpsFlushQueue: { add: vi.fn() },
}))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(), hashOtp: vi.fn() }))
vi.mock('@/modules/payments/payments.service', () => ({ createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn() }))
const offers = vi.hoisted(() => ({ resolve: vi.fn(), reserve: vi.fn() }))
vi.mock('@/modules/offers/offers.service', () => ({ resolveForBooking: offers.resolve }))
vi.mock('@/modules/offers/offers.repository', () => ({ reserveRedemption: offers.reserve, normalizeCode: (c: string) => c.trim().toUpperCase() }))
vi.mock('@/modules/geo/geo.service', () => ({
  classifyTrip: vi.fn(async () => ({ scope: 'intercity' })),
  findNearestCity: vi.fn(async () => ({ id: 1 })),
  getRoute: vi.fn(), snapTrailToRoads: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { createBooking } from '@/modules/rides/rides.service'

// Booking with an offer (offers plan Task 6). Value: protects=the discount comes only from the server, the booking is
// one transaction, a changed price books nothing, older apps are never given an automatic offer; fails_when=the
// resolver is skipped/trusted, the reservation moves outside the transaction, or the price check is dropped;
// why_new=no test covered booking with an offer; seam=none; no_claim=the SQL itself (repository and client are fakes).

const FARE = {
  pricing_version: 1 as const, rate_card_id: 3, surge_event_id: null, surge_multiplier: 1, charge_per_stop: 0,
  breakdown: { base_fare: 400, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 54, total: 454 },
}
const REQUEST = {
  categoryId: 1, rideType: 'one_way' as const, originLat: 20.29, originLng: 85.82, destinationLat: 20.45, destinationLng: 85.88,
  distanceKm: 18, durationMin: 30, paymentChannel: 'online' as const,
}
const OFFER = { offerId: '5', versionId: '9', code: 'SAVE10', name: 'n', kind: 'code', summary: '10% off', discount: 40, cashback: 0, perUserLimit: 1 }
const evaluation = (chosen: typeof OFFER | null, payable = 414, enabled = true) => ({
  enabled, chosen, result: { fareTotal: 454, discount: chosen?.discount ?? 0, cashback: 0, payable, applied: chosen, alternatives: [], rejected: [] },
})
const sqls = () => bookingClient.query.mock.calls.map((c) => String((c as unknown[])[0]))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
  vi.mocked(repo.createRide).mockResolvedValue({ id: 77n } as never)
  vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  vi.mocked(repo.insertFareSnapshot).mockResolvedValue(undefined as never) // clearAllMocks keeps a previous test's rejection
  vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
  offers.resolve.mockResolvedValue(evaluation(null, 454))
  offers.reserve.mockResolvedValue({ ok: true, redemptionId: 1n })
})

describe('createBooking with an offer', () => {
  it('stores the discount, reserves the pinned version and reports the payable, all inside one transaction', async () => {
    offers.resolve.mockResolvedValue(evaluation(OFFER))
    const res = await createBooking(7n, { ...REQUEST, couponCode: 'save10' })
    expect(vi.mocked(repo.insertFareSnapshot).mock.calls[0]![1]).toMatchObject({ discountAmount: 40, total: 454 })
    expect(offers.reserve).toHaveBeenCalledWith(bookingClient, expect.objectContaining({ offerId: 5n, versionId: 9n, rideId: 77n, discount: 40 }))
    expect(res).toMatchObject({ discount: 40, payable: 414, appliedOffer: expect.objectContaining({ code: 'SAVE10' }) })
    const s = sqls()
    expect(s[0]).toBe('BEGIN')
    expect(s.at(-1)).toBe('COMMIT')
    expect(s).not.toContain('ROLLBACK')
  })

  it('a failing snapshot insert rolls everything back and reserves nothing', async () => {
    offers.resolve.mockResolvedValue(evaluation(OFFER))
    vi.mocked(repo.insertFareSnapshot).mockRejectedValue(new Error('boom'))
    await expect(createBooking(7n, { ...REQUEST, couponCode: 'SAVE10' })).rejects.toThrow('boom')
    expect(offers.reserve).not.toHaveBeenCalled()
    expect(sqls()).toContain('ROLLBACK')
    expect(sqls()).not.toContain('COMMIT')
    expect(bookingClient.release).toHaveBeenCalledTimes(1)
  })

  it('an invalid typed code fails with OFFER_NOT_APPLICABLE and creates nothing', async () => {
    offers.resolve.mockResolvedValue({ ...evaluation(null, 454), result: { ...evaluation(null, 454).result, rejected: [{ code: 'NOPE', reason: 'UNKNOWN_CODE', message: "That code isn't valid" }] } })
    await expect(createBooking(7n, { ...REQUEST, couponCode: 'NOPE' })).rejects.toMatchObject({ httpStatus: 422, appCode: 'OFFER_NOT_APPLICABLE', message: "That code isn't valid" })
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('a typed code that loses to a different offer is also refused (never silently swapped)', async () => {
    offers.resolve.mockResolvedValue(evaluation({ ...OFFER, code: 'OTHER' }))
    await expect(createBooking(7n, { ...REQUEST, couponCode: 'SAVE10' })).rejects.toMatchObject({ appCode: 'OFFER_NOT_APPLICABLE' })
  })

  it('while offers are off a coupon code is ignored and the booking is at the gross fare', async () => {
    offers.resolve.mockResolvedValue(evaluation(null, 454, false))
    const res = await createBooking(7n, { ...REQUEST, couponCode: 'SAVE10' })
    expect(vi.mocked(repo.insertFareSnapshot).mock.calls[0]![1]).toMatchObject({ discountAmount: 0 })
    expect(offers.reserve).not.toHaveBeenCalled()
    expect(res).toMatchObject({ discount: 0, payable: 454, appliedOffer: null })
  })

  it('ignores any discount or fare the client sends', async () => {
    await createBooking(7n, { ...REQUEST, discount: 999, payable: 1, total: 1 } as never)
    expect(vi.mocked(repo.insertFareSnapshot).mock.calls[0]![1]).toMatchObject({ discountAmount: 0, total: 454 })
  })
})

describe('expectedPayable (D10)', () => {
  it('books when the payable matches within a paisa', async () => {
    offers.resolve.mockResolvedValue(evaluation(OFFER))
    await createBooking(7n, { ...REQUEST, expectedPayable: 414.005 })
    expect(repo.createRide).toHaveBeenCalledTimes(1)
  })

  it('answers 409 PRICE_CHANGED with the new price and creates nothing when it differs', async () => {
    offers.resolve.mockResolvedValue(evaluation(null, 454))
    await expect(createBooking(7n, { ...REQUEST, expectedPayable: 414 })).rejects.toMatchObject({
      httpStatus: 409, appCode: 'PRICE_CHANGED',
      details: { fareTotal: 454, payable: 454, discount: 0, reason: 'OFFER_UNAVAILABLE' },
    })
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('offers switched off after the rider saw a discount: 409 with the gross price, not a silent full-price booking', async () => {
    offers.resolve.mockResolvedValue(evaluation(null, 454, false))
    await expect(createBooking(7n, { ...REQUEST, expectedPayable: 363 })).rejects.toMatchObject({ httpStatus: 409, appCode: 'PRICE_CHANGED', details: { payable: 454 } })
    expect(repo.createRide).not.toHaveBeenCalled()
    // an app that saw the gross price books normally
    await createBooking(7n, { ...REQUEST, expectedPayable: 454 })
    expect(repo.createRide).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-numeric expectedPayable', async () => {
    await expect(createBooking(7n, { ...REQUEST, expectedPayable: 'free' as never })).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('an older app (no coupon, no expectedPayable) never gets an automatic offer', async () => {
    const res = await createBooking(7n, { ...REQUEST })
    expect(offers.resolve).not.toHaveBeenCalled()
    expect(res).toMatchObject({ discount: 0, payable: 454, appliedOffer: null })
  })

  it('losing the race for the last use of an automatic offer answers PRICE_CHANGED, for a typed code OFFER_NOT_APPLICABLE; both roll back', async () => {
    offers.resolve.mockResolvedValue(evaluation(OFFER))
    offers.reserve.mockResolvedValue({ ok: false, reason: 'BUDGET' })
    await expect(createBooking(7n, { ...REQUEST, expectedPayable: 414 })).rejects.toMatchObject({ appCode: 'PRICE_CHANGED', details: { payable: 454, fareTotal: 454 } }) // never a Rs 0 price
    await expect(createBooking(7n, { ...REQUEST, couponCode: 'SAVE10' })).rejects.toMatchObject({ appCode: 'OFFER_NOT_APPLICABLE' })
    expect(sqls().filter((q) => q === 'ROLLBACK')).toHaveLength(2)
  })
})
