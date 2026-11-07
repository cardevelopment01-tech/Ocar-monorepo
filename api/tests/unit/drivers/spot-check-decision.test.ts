import { describe, it, expect, vi } from 'vitest'

// The engine file also pulls in the DB-backed service; only the pure decision is under test here.
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))
vi.mock('@/modules/drivers/driver-verification.repository', () => ({}))
vi.mock('@/modules/drivers/driver-verification.service', () => ({ resolveMode: vi.fn() }))

import { decideSpotCheck, type SpotCheckConfig } from '@/modules/drivers/spot-check.engine'

const cfg: SpotCheckConfig = { ridesMin: 2, ridesMax: 3, longRideKm: 60, longRideMinutes: 90 }
const ride = (over: Partial<{ rideType: string; distanceKm: number | null; durationMin: number | null }> = {}) =>
  ({ rideType: 'one_way', distanceKm: 10, durationMin: 20, ...over })

describe('decideSpotCheck', () => {
  it('opens when the rides since the last check reach the drawn target', () => {
    expect(decideSpotCheck({ cfg, ride: ride(), ridesSinceVerified: 2, target: 3 })).toBeNull()
    expect(decideSpotCheck({ cfg, ride: ride(), ridesSinceVerified: 3, target: 3 })).toBe('rides')
    expect(decideSpotCheck({ cfg, ride: ride(), ridesSinceVerified: 5, target: 2 })).toBe('rides')
  })

  it('a long one-way or round-trip ride always triggers, by distance or by duration', () => {
    expect(decideSpotCheck({ cfg, ride: ride({ distanceKm: 60 }), ridesSinceVerified: 1, target: 9 })).toBe('long_ride')
    expect(decideSpotCheck({ cfg, ride: ride({ rideType: 'round_trip', durationMin: 90 }), ridesSinceVerified: 1, target: 9 })).toBe('long_ride')
    expect(decideSpotCheck({ cfg, ride: ride({ distanceKm: 59.9, durationMin: 89.9 }), ridesSinceVerified: 1, target: 9 })).toBeNull()
  })

  it('a long rental does not count as a long ride, but still counts toward the ride target', () => {
    expect(decideSpotCheck({ cfg, ride: ride({ rideType: 'rental', distanceKm: 400, durationMin: 600 }), ridesSinceVerified: 1, target: 9 })).toBeNull()
    expect(decideSpotCheck({ cfg, ride: ride({ rideType: 'rental' }), ridesSinceVerified: 9, target: 9 })).toBe('rides')
  })

  it('long ride wins over the counter, and unknown distance/duration never triggers it', () => {
    expect(decideSpotCheck({ cfg, ride: ride({ distanceKm: 100 }), ridesSinceVerified: 9, target: 2 })).toBe('long_ride')
    expect(decideSpotCheck({ cfg, ride: ride({ distanceKm: null, durationMin: null }), ridesSinceVerified: 1, target: 9 })).toBeNull()
  })
})
