import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendRideStatusUpdate: vi.fn() }, getIO: vi.fn() }))
const add = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/jobs/queues', () => ({ queues: { dispatch: { add } }, QUEUE_NAMES: { DISPATCH: 'dispatch' } }))
vi.mock('@/modules/pricing/pricing.service', () => ({ getFareEstimate: vi.fn() }))
vi.mock('@/modules/offers/settlement', () => ({ finaliseDiscount: vi.fn().mockResolvedValue(0) }))
vi.mock('@/modules/rides/rides.repository', () => ({
  updateRideStatusCAS: vi.fn(),
  getRideCoreById: vi.fn(),
  logStatusHistory: vi.fn().mockResolvedValue(undefined),
  updateAdvanceMetaStatus: vi.fn().mockResolvedValue(undefined),
  getFareRecomputeInput: vi.fn(),
  updateFareSnapshotEstimate: vi.fn().mockResolvedValue(undefined),
}))

import * as repo from '@/modules/rides/rides.repository'
import { getFareEstimate } from '@/modules/pricing/pricing.service'
import { processDispatchScheduled } from '@/jobs/processors/dispatch-scheduled.processor'

const RIDE = {
  id: 5n, category_id: 2n, origin_lat: 20.29, origin_lng: 85.82, ride_type: 'rental', is_return_cab: false,
  dest_lat: null, dest_lng: null, trip_hours: '4',
}
const RECOMPUTE = {
  category_id: 2, origin_city_id: 1, ride_type: 'rental', is_return_cab: false, estimated_km: 0, estimated_min: 0,
  stop_count: 0, trip_hours: 4, pricing_version: 1, rental_package_id: 12, total_estimated: 500, discount_amount: 0,
}

describe('processDispatchScheduled: the fare re-quote can never stop a ride being dispatched', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    add.mockResolvedValue(undefined)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ id: 5n } as never)
    vi.mocked(repo.getRideCoreById).mockResolvedValue(RIDE as never)
    vi.mocked(repo.getFareRecomputeInput).mockResolvedValue(RECOMPUTE as never)
  })

  it('dispatches on the booked quote when the re-quote fails (for example the rental package was deactivated)', async () => {
    vi.mocked(getFareEstimate).mockRejectedValue(Object.assign(new Error('This rental package is not available'), { httpStatus: 422 }))

    await processDispatchScheduled({ rideId: '5' })

    expect(repo.updateFareSnapshotEstimate).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledTimes(3) // the three broadcast rounds
  })

  it('re-quotes a city ride on the city card (it must not fall back to the intercity card)', async () => {
    vi.mocked(repo.getFareRecomputeInput).mockResolvedValue({ ...RECOMPUTE, ride_type: 'one_way', rental_package_id: null, trip_mode: 'city' } as never)
    vi.mocked(getFareEstimate).mockResolvedValue({
      rate_card_id: 21, surge_event_id: null, surge_multiplier: 1, pricing_version: 1, charge_per_stop: 0,
      breakdown: { base_fare: 0, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 0, total: 297 },
    } as never)
    await processDispatchScheduled({ rideId: '5' })
    expect(vi.mocked(getFareEstimate).mock.calls[0]![0]).toMatchObject({ trip_mode: 'city' })
  })

  it('a standard ride is re-quoted with no trip mode, as before', async () => {
    vi.mocked(repo.getFareRecomputeInput).mockResolvedValue({ ...RECOMPUTE, trip_mode: 'standard' } as never)
    vi.mocked(getFareEstimate).mockResolvedValue({
      rate_card_id: 1, surge_event_id: null, surge_multiplier: 1, pricing_version: 1, charge_per_stop: 0,
      breakdown: { base_fare: 500, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 0, total: 500 },
    } as never)
    await processDispatchScheduled({ rideId: '5' })
    expect(vi.mocked(getFareEstimate).mock.calls[0]![0]).not.toHaveProperty('trip_mode')
  })

  it('still re-prices and dispatches when the re-quote works', async () => {
    vi.mocked(getFareEstimate).mockResolvedValue({
      rate_card_id: null, surge_event_id: null, surge_multiplier: 1, pricing_version: 1, charge_per_stop: 0,
      breakdown: { base_fare: 500, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 0, total: 500 },
    } as never)

    await processDispatchScheduled({ rideId: '5' })

    expect(repo.updateFareSnapshotEstimate).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledTimes(3)
  })
})
