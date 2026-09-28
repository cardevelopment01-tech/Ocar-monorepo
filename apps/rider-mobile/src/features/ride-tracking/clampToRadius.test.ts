import { describe, it, expect } from 'vitest'
import { haversineMetres } from '@ocar/mobile-shared/src/utils/polyline'
import { clampToRadius } from './clampToRadius'

const origin: [number, number] = [20.29, 85.82]

describe('clampToRadius', () => {
  it('returns the point unchanged when already inside the radius', () => {
    const point: [number, number] = [20.2905, 85.8205]
    expect(clampToRadius(origin, point, 150)).toEqual(point)
  })

  it('scales a too-far point back to exactly the radius, on the same bearing', () => {
    const farPoint: [number, number] = [20.30, 85.82] // ~1.1km north
    const clamped = clampToRadius(origin, farPoint, 150)

    expect(haversineMetres(origin, clamped)).toBeCloseTo(150, 0)
    // Same bearing: latitude moved the same direction, longitude untouched
    // (the test point is due north of origin).
    expect(clamped[0]).toBeGreaterThan(origin[0])
    expect(clamped[1]).toBeCloseTo(origin[1], 5)
  })

  it('returns the origin itself unchanged (zero distance, no division by zero)', () => {
    expect(clampToRadius(origin, origin, 150)).toEqual(origin)
  })
})
