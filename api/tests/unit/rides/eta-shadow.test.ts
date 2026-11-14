import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shadow ETA (docs/superpowers/plans/2026-11-10-google-maps-cost.md, phase B): off = nothing happens; on = a ride leg's route is kept, driver
// pings are sampled at most every 30 s, rider route answers are noted, and nothing here can ever throw into a ride, a ping or a route request.

const redisGet = vi.fn()
const redisSet = vi.fn()
vi.mock('@/db/redis', () => ({ client: { get: (...a: unknown[]) => redisGet(...a), set: (...a: unknown[]) => redisSet(...a) } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))
vi.mock('@/modules/rides/rides.repository', () => ({ insertEtaShadow: vi.fn().mockResolvedValue(undefined), getActiveRideIdForUser: vi.fn() }))

import { getConfigValue } from '@/lib/system-config'
import * as repo from '@/modules/rides/rides.repository'
import { storeShadowLeg, recordShadowPing, recordShadowGoogle, resetShadowMemo, shadowEnabled } from '@/modules/rides/eta-shadow'
import { haversineM } from '@/lib/route-progress'

// Minimal encoder for Google polylines (precision 1e5), to build routes for the tests.
function encodePolyline(points: Array<[number, number]>): string {
  let prevLat = 0, prevLng = 0, out = ''
  const enc = (v: number): string => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = ''
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5 }
    return s + String.fromCharCode(n + 63)
  }
  for (const [la, ln] of points) {
    const a = Math.round(la * 1e5), b = Math.round(ln * 1e5)
    out += enc(a - prevLat) + enc(b - prevLng)
    prevLat = a; prevLng = b
  }
  return out
}

// A straight 21-point road east along latitude 20.0 from lng 85.0 to 85.2 (about 21 km).
const ROAD: Array<[number, number]> = Array.from({ length: 21 }, (_, i) => [20, 85 + i * 0.01])
const POLY = encodePolyline(ROAD)
const TOTAL_M = haversineM(ROAD[0]!, ROAD[20]!)
const BASELINE_SEC = 1260 // 60 km/h: about 21 km
const googleRoute = { polyline: POLY, source: 'google', trafficDurationSec: BASELINE_SEC, durationSec: BASELINE_SEC }
const DEST = { lat: 20, lng: 85.2 }

let store: Map<string, string>
function on() { vi.mocked(getConfigValue).mockResolvedValue('true') }
const calls = () => vi.mocked(repo.insertEtaShadow).mock.calls.map((c) => c[0])

beforeEach(() => {
  vi.clearAllMocks()
  resetShadowMemo()
  store = new Map()
  redisGet.mockImplementation(async (k: string) => store.get(k) ?? null)
  redisSet.mockImplementation(async (k: string, v: string) => { store.set(k, v); return 'OK' })
  vi.mocked(repo.insertEtaShadow).mockResolvedValue(undefined)
  vi.mocked(getConfigValue).mockResolvedValue('false')
})

describe('the switch', () => {
  it('off: nothing is stored, sampled or logged, and no Redis or database call is made', async () => {
    await storeShadowLeg('7', 'to_pickup', googleRoute, DEST)
    await recordShadowPing('7', 20, 85.05)
    await recordShadowGoogle(1n, DEST, { distanceKm: 5, durationMin: 6, source: 'google' })
    expect(redisSet).not.toHaveBeenCalled()
    expect(redisGet).not.toHaveBeenCalled()
    expect(repo.insertEtaShadow).not.toHaveBeenCalled()
  })

  it('is read once and remembered for 30 s, and a failing settings read means off', async () => {
    on()
    expect(await shadowEnabled(1_000)).toBe(true)
    expect(await shadowEnabled(20_000)).toBe(true)
    expect(getConfigValue).toHaveBeenCalledTimes(1)
    vi.mocked(getConfigValue).mockResolvedValue('false')
    expect(await shadowEnabled(40_000)).toBe(false)
    resetShadowMemo()
    vi.mocked(getConfigValue).mockRejectedValue(new Error('redis down'))
    expect(await shadowEnabled()).toBe(false)
  })
})

describe('storeShadowLeg', () => {
  beforeEach(on)

  it('keeps the route with the destination, for up to six hours', async () => {
    await storeShadowLeg('7', 'to_pickup', googleRoute, DEST)
    expect(redisSet).toHaveBeenCalledWith('ride:eta_shadow_leg:7', expect.any(String), 'EX', 6 * 3600)
    const stored = JSON.parse(store.get('ride:eta_shadow_leg:7')!)
    expect(stored).toMatchObject({ leg: 'to_pickup', polyline: POLY, baselineSec: BASELINE_SEC, destLat: 20, destLng: 85.2 })
  })

  it.each([
    ['a route that did not come from Google', { ...googleRoute, source: 'osrm' }],
    ['a route with no line', { ...googleRoute, polyline: '' }],
    ['a route with no duration', { polyline: POLY, source: 'google' }],
  ])('does not keep %s', async (_n, route) => {
    await storeShadowLeg('7', 'to_pickup', route, DEST)
    expect(redisSet).not.toHaveBeenCalled()
  })

  it('uses the live-traffic duration when there is one, else the plain duration', async () => {
    await storeShadowLeg('7', 'to_pickup', { polyline: POLY, source: 'google', durationSec: 1000, trafficDurationSec: 1200 }, DEST)
    expect(JSON.parse(store.get('ride:eta_shadow_leg:7')!).baselineSec).toBe(1200)
    await storeShadowLeg('8', 'to_pickup', { polyline: POLY, source: 'google', durationSec: 1000 }, DEST)
    expect(JSON.parse(store.get('ride:eta_shadow_leg:8')!).baselineSec).toBe(1000)
  })

  it('a Redis failure is swallowed', async () => {
    redisSet.mockRejectedValue(new Error('down'))
    await expect(storeShadowLeg('7', 'to_pickup', googleRoute, DEST)).resolves.toBeUndefined()
  })
})

describe('recordShadowPing', () => {
  beforeEach(async () => { on(); await storeShadowLeg('7', 'to_destination', googleRoute, DEST) })

  it('logs what the stored route and the driver\'s progress give: halfway along, about half the time left', async () => {
    await recordShadowPing('7', 20, 85.1, 100_000)
    expect(calls()).toHaveLength(1)
    const row = calls()[0]!
    expect(row).toMatchObject({ rideId: 7n, leg: 'to_destination', kind: 'ours' })
    expect(row.remainingM).toBeCloseTo(TOTAL_M / 2, -2)
    expect(row.etaSec).toBeCloseTo(BASELINE_SEC / 2, -1)
    expect(row.etaBaseSec).toBeCloseTo(BASELINE_SEC / 2, -1)
    expect(row.offRouteM).toBe(0)
  })

  it('samples a ride at most every 30 s, even when pings arrive together', async () => {
    await Promise.all([recordShadowPing('7', 20, 85.05, 100_000), recordShadowPing('7', 20, 85.05, 100_010)])
    await recordShadowPing('7', 20, 85.06, 120_000)
    expect(calls()).toHaveLength(1)
    await recordShadowPing('7', 20, 85.07, 131_000)
    expect(calls()).toHaveLength(2)
  })

  it('a second sample uses the observed progress: a faster car than the route implied pulls the blended ETA below the baseline one', async () => {
    await recordShadowPing('7', 20, 85.0, 0)
    await recordShadowPing('7', 20, 85.1, 30_000) // 10.5 km in 30 s: far faster than the baseline, capped inside the blend
    const row = calls()[1]!
    expect(row.etaSec!).toBeLessThan(row.etaBaseSec!)
  })

  it('a position far from the route is logged with its distance and does not move the speed state', async () => {
    await recordShadowPing('7', 20.01, 85.1, 100_000) // about 1.1 km north of the road
    expect(calls()[0]!.offRouteM).toBeGreaterThan(100)
  })

  it('does nothing for a ride with no stored leg (one read, no write)', async () => {
    await recordShadowPing('99', 20, 85.1, 100_000)
    expect(repo.insertEtaShadow).not.toHaveBeenCalled()
  })

  it('a new leg replaces the old one and starts its speed history afresh', async () => {
    await recordShadowPing('7', 20, 85.1, 0)
    const other = encodePolyline([[21, 86], [21, 86.1]])
    await storeShadowLeg('7', 'to_pickup', { polyline: other, source: 'google', trafficDurationSec: 600 }, { lat: 21, lng: 86.1 })
    await recordShadowPing('7', 21, 86.05, 40_000)
    expect(calls()[1]).toMatchObject({ leg: 'to_pickup' })
    expect(calls()[1]!.remainingM).toBeCloseTo(haversineM([21, 86.05], [21, 86.1]), -2)
  })

  it('a database failure is swallowed and does not block later samples', async () => {
    vi.mocked(repo.insertEtaShadow).mockRejectedValueOnce(new Error('db down'))
    await expect(recordShadowPing('7', 20, 85.1, 0)).resolves.toBeUndefined()
    await recordShadowPing('7', 20, 85.1, 31_000)
    expect(calls()).toHaveLength(2)
  })

  it('a ping before the leg exists only delays the next try by a few seconds, not a whole sampling gap', async () => {
    await recordShadowPing('55', 20, 85.1, 100_000)                  // no leg yet
    expect(repo.insertEtaShadow).not.toHaveBeenCalled()
    // Stored by another instance a moment later: written straight to Redis, so this process's own memory is not cleared (as storeShadowLeg would).
    store.set('ride:eta_shadow_leg:55', JSON.stringify({ leg: 'to_destination', polyline: POLY, baselineSec: BASELINE_SEC, destLat: DEST.lat, destLng: DEST.lng, storedAt: 1 }))
    await recordShadowPing('55', 20, 85.1, 106_000)                  // 6 s after the first ping
    expect(calls()).toHaveLength(1)
  })

  it('a vehicle that has reached the destination is not sampled: waiting there is not travel time', async () => {
    await recordShadowPing('7', 20, 85.2, 100_000)
    expect(repo.insertEtaShadow).not.toHaveBeenCalled()
    await recordShadowPing('7', 20, 85.1995, 140_000) // about 50 m short of it
    expect(repo.insertEtaShadow).not.toHaveBeenCalled()
  })

  it('a corrupt stored value is ignored', async () => {
    store.set('ride:eta_shadow_leg:7', '{not json')
    await expect(recordShadowPing('7', 20, 85.1, 200_000)).resolves.toBeUndefined()
    expect(repo.insertEtaShadow).not.toHaveBeenCalled()
  })
})

describe('recordShadowGoogle', () => {
  beforeEach(async () => {
    on()
    await storeShadowLeg('7', 'to_destination', googleRoute, DEST)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue('7')
  })
  const answer = { distanceKm: 10.2, durationMin: 14, trafficDurationMin: 16, source: 'google' }

  it('logs what the rider was shown for the stored leg, with the live-traffic minutes', async () => {
    await recordShadowGoogle(5n, { lat: 20.0005, lng: 85.2 }, answer, 1_000_000)
    expect(calls()).toEqual([{ rideId: 7n, leg: 'to_destination', kind: 'google', etaSec: 16 * 60, remainingM: 10_200 }])
  })

  it('uses the seconds when the answer carries them', async () => {
    await recordShadowGoogle(5n, DEST, { ...answer, trafficDurationSec: 951 }, 1_000_000)
    expect(calls()[0]!.etaSec).toBe(951)
  })

  it('ignores a request for some other destination, a fallback answer, and a rider with no active ride', async () => {
    await recordShadowGoogle(5n, { lat: 20.05, lng: 85.2 }, answer, 1_000_000)           // 5 km from the leg's destination
    await recordShadowGoogle(5n, DEST, { ...answer, source: 'osrm' }, 2_000_000)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
    await recordShadowGoogle(6n, DEST, answer, 3_000_000)
    expect(repo.insertEtaShadow).not.toHaveBeenCalled()
  })

  it('samples a ride at most every 20 s, and asks for the active ride only once per few seconds', async () => {
    await recordShadowGoogle(5n, DEST, answer, 1_000_000)
    await recordShadowGoogle(5n, DEST, answer, 1_005_000)
    await recordShadowGoogle(5n, DEST, answer, 1_021_000)
    expect(calls()).toHaveLength(2)
    expect(repo.getActiveRideIdForUser).toHaveBeenCalledTimes(1) // the second and third come from the short cache
  })

  it('a request for another destination does not use up the sampling slot of the tracking refresh that follows it', async () => {
    await recordShadowGoogle(5n, { lat: 20.05, lng: 85.2 }, answer, 1_000_000)  // some other route: not noted
    await recordShadowGoogle(5n, DEST, answer, 1_002_000)                         // 2 s later, the real one: noted
    expect(calls()).toHaveLength(1)
  })

  it('"no ride" is not remembered: a rider who has just booked, or whose next leg has just started, is not missed', async () => {
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValueOnce(null).mockResolvedValue('7')
    await recordShadowGoogle(8n, DEST, answer, 1_000_000)
    await recordShadowGoogle(8n, DEST, answer, 1_001_000)
    expect(repo.getActiveRideIdForUser).toHaveBeenCalledTimes(2)
    expect(calls()).toHaveLength(1)
  })

  it('failures are swallowed', async () => {
    vi.mocked(repo.getActiveRideIdForUser).mockRejectedValue(new Error('db down'))
    await expect(recordShadowGoogle(9n, DEST, answer, 5_000_000)).resolves.toBeUndefined()
  })
})
