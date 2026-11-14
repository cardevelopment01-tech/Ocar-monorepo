import { describe, it, expect } from 'vitest'
import { decodePolyline, buildRoute, projectOnRoute, etaFromProgress, FRESH_ETA_STATE, haversineM, OFF_ROUTE_M, type LatLng } from '@/lib/route-progress'

// A straight east-west road along latitude 20.0: 1 degree of longitude is about 104.6 km there, so lng offsets are easy to reason about.
const line = (lng0: number, lng1: number, lat = 20, steps = 20): LatLng[] =>
  Array.from({ length: steps + 1 }, (_, i) => [lat, lng0 + ((lng1 - lng0) * i) / steps] as LatLng)

describe('decodePolyline', () => {
  it('decodes the reference example from Google\'s documentation', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(pts).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
  })

  it('an empty or truncated string gives the points decoded so far and never throws', () => {
    expect(decodePolyline('')).toEqual([])
    expect(decodePolyline('_p~iF~ps|U_ulL')).toEqual([[38.5, -120.2]]) // second point cut in half
  })
})

describe('buildRoute', () => {
  it('accumulates distance along the route', () => {
    const r = buildRoute(line(85.0, 85.1))
    expect(r.cumM[0]).toBe(0)
    expect(r.totalM).toBeCloseTo(haversineM([20, 85.0], [20, 85.1]), 0)
    expect(r.cumM.every((v, i) => i === 0 || v > r.cumM[i - 1]!)).toBe(true)
  })
})

describe('projectOnRoute', () => {
  const route = buildRoute(line(85.0, 85.1))

  it('a position on the road is placed at the right distance along it', () => {
    const p = projectOnRoute(route, 20, 85.05)!
    expect(p.distM).toBeLessThan(1)
    expect(p.alongM).toBeCloseTo(route.totalM / 2, -1)
    expect(p.offRoute).toBe(false)
  })

  it('a small sideways offset is still on the route, a big one is flagged off-route', () => {
    const near = projectOnRoute(route, 20 + 30 / 110_540, 85.05)!
    expect(near.distM).toBeCloseTo(30, 0)
    expect(near.offRoute).toBe(false)
    const far = projectOnRoute(route, 20 + 300 / 110_540, 85.05)!
    expect(far.distM).toBeGreaterThan(OFF_ROUTE_M)
    expect(far.offRoute).toBe(true)
  })

  it('before the start and past the end clamp to the ends', () => {
    expect(projectOnRoute(route, 20, 84.99)!.alongM).toBe(0)
    expect(projectOnRoute(route, 20, 85.2)!.alongM).toBeCloseTo(route.totalM, 0)
  })

  it('a route with fewer than two points cannot be projected on', () => {
    expect(projectOnRoute(buildRoute([[20, 85]]), 20, 85)).toBeNull()
  })

  it('a route that doubles back along a street 20 m away does not pull the car to the wrong pass', () => {
    // out east along lat 20.0, a short hop north, then back west along lat 20.0002 (about 22 m away)
    const out = line(85.0, 85.02, 20, 10)
    const back = line(85.02, 85.0, 20.0002, 10)
    const loop = buildRoute([...out, ...back])
    const outLengthM = haversineM([20, 85.0], [20, 85.02])
    // The car is on the way out, 100 m in, but the point is closer to the return pass.
    const lat = 20.00015, lng = 85.001
    const ambiguous = projectOnRoute(loop, lat, lng)!
    expect(ambiguous.alongM).toBeGreaterThan(outLengthM) // with no progress information the nearest pass is the return one: the ambiguity itself
    const forward = projectOnRoute(loop, lat, lng, 100, 1000)!
    expect(forward.alongM).toBeLessThan(outLengthM / 2)
    // A car that really is on the way back (progress already past the turn) is placed on the return pass.
    const onReturn = projectOnRoute(loop, 20.0002, 85.01, outLengthM + 500, 3000)!
    expect(onReturn.alongM).toBeGreaterThan(outLengthM)
  })

  it('a position a little behind the last known progress (GPS jitter) stays where it was, not a jump', () => {
    const p = projectOnRoute(route, 20, 85.0499, route.totalM / 2, 3000)!
    expect(Math.abs(p.alongM - route.totalM / 2)).toBeLessThan(30)
  })

  it('far from the forward window falls back to a whole-route search and is flagged off-route when still far', () => {
    const p = projectOnRoute(route, 20.01, 85.0, route.totalM, 1000)!
    expect(p.offRoute).toBe(true)
  })
})

describe('etaFromProgress', () => {
  const totalM = 30_000, baselineSec = 1800 // 60 km/h baseline: 16.67 m/s

  it('at the start the ETA is Google\'s duration, for both variants', () => {
    const r = etaFromProgress({ totalM, baselineSec, alongM: 0, nowMs: 0, state: FRESH_ETA_STATE })!
    expect(r.remainingM).toBe(30_000)
    expect(r.etaBaseSec).toBeCloseTo(1800, 5)
    expect(r.etaBlendSec).toBeCloseTo(1800, 5)
  })

  it('at the end there is nothing left', () => {
    const r = etaFromProgress({ totalM, baselineSec, alongM: 31_000, nowMs: 0, state: FRESH_ETA_STATE })!
    expect(r.remainingM).toBe(0)
    expect(r.etaBlendSec).toBe(0)
  })

  it('a car going faster than the route implied pulls the blended ETA down, the baseline ETA does not move', () => {
    const s1 = etaFromProgress({ totalM, baselineSec, alongM: 0, nowMs: 0, state: FRESH_ETA_STATE })!
    const s2 = etaFromProgress({ totalM, baselineSec, alongM: 1200, nowMs: 30_000, state: s1.state })! // 40 m/s observed
    expect(s2.etaBlendSec).toBeLessThan(s2.etaBaseSec)
    expect(s2.etaBaseSec).toBeCloseTo((30_000 - 1200) / (30_000 / 1800), 5)
  })

  it('a stopped car never gives an ETA more than twice the baseline (clamped at half speed)', () => {
    let st = etaFromProgress({ totalM, baselineSec, alongM: 5000, nowMs: 0, state: FRESH_ETA_STATE })!.state
    let r = etaFromProgress({ totalM, baselineSec, alongM: 5000, nowMs: 30_000, state: st })!
    for (let i = 2; i < 12; i++) { st = r.state; r = etaFromProgress({ totalM, baselineSec, alongM: 5000, nowMs: i * 30_000, state: st })! }
    expect(r.etaBlendSec).toBeLessThanOrEqual(r.etaBaseSec * 2 + 1e-6)
    expect(Number.isFinite(r.etaBlendSec)).toBe(true)
  })

  it('a very fast reading is capped at 1.5x the baseline speed', () => {
    const s1 = etaFromProgress({ totalM, baselineSec, alongM: 0, nowMs: 0, state: FRESH_ETA_STATE })!
    const s2 = etaFromProgress({ totalM, baselineSec, alongM: 20_000, nowMs: 30_000, state: s1.state })!
    expect(s2.etaBlendSec).toBeGreaterThanOrEqual(s2.etaBaseSec / 1.5 - 1e-6)
  })

  it('progress that goes backwards, or samples closer than 10 s, do not change the observed speed', () => {
    const s1 = etaFromProgress({ totalM, baselineSec, alongM: 1000, nowMs: 0, state: FRESH_ETA_STATE })!
    const back = etaFromProgress({ totalM, baselineSec, alongM: 900, nowMs: 30_000, state: s1.state })!
    expect(back.state.emaSpeedMps).toBeNull()
    const quick = etaFromProgress({ totalM, baselineSec, alongM: 1100, nowMs: 5_000, state: s1.state })!
    expect(quick.state.emaSpeedMps).toBeNull()
  })

  it('rejects a route or baseline it cannot divide by', () => {
    expect(etaFromProgress({ totalM: 0, baselineSec, alongM: 0, nowMs: 0, state: FRESH_ETA_STATE })).toBeNull()
    expect(etaFromProgress({ totalM, baselineSec: 0, alongM: 0, nowMs: 0, state: FRESH_ETA_STATE })).toBeNull()
    expect(etaFromProgress({ totalM, baselineSec, alongM: NaN, nowMs: 0, state: FRESH_ETA_STATE })).toBeNull()
  })
})
