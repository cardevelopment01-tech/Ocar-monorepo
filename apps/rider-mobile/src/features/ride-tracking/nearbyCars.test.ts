import { describe, expect, it } from 'vitest'
import { bearingDegrees, carStep, carsToFrame, fadeOpacity, FADE_STEPS, metresBetween, MAX_GLIDE_METRES, type LatLng } from './nearbyCars'

// Value: protects=the "cars near you" layer on the searching map: the camera frames only the closest few cars, each car
// turns the way it drives, and a teleport never glides across the city; fails_when=a bearing is off by a quadrant, far cars
// stretch the camera, or a stale jump is animated; why_new=searching-map nearby cars; seam=none (pure maths);
// no_claim=how the native map animates a marker.
const P: LatLng = [20.2961, 85.8245] // Bhubaneswar
const DEG_PER_M = 1 / 111_320
const north = (m: number): LatLng => [P[0] + m * DEG_PER_M, P[1]]
const east = (m: number): LatLng => [P[0], P[1] + (m * DEG_PER_M) / Math.cos((P[0] * Math.PI) / 180)]

describe('bearingDegrees', () => {
  it('points the four compass directions', () => {
    expect(Math.round(bearingDegrees(P, north(100)))).toBe(0)
    expect(Math.round(bearingDegrees(P, east(100)))).toBe(90)
    expect(Math.round(bearingDegrees(north(100), P))).toBe(180)
    expect(Math.round(bearingDegrees(east(100), P))).toBe(270)
  })
})

describe('carsToFrame', () => {
  const car = (id: string, at: LatLng) => ({ driverId: id, lat: at[0], lng: at[1] })
  it('frames the nearest few cars within range, nearest first, and ignores far ones', () => {
    const cars = [car('far', north(5000)), car('c', north(900)), car('a', north(100)), car('b', east(400))]
    const framed = carsToFrame(P, cars)
    expect(framed).toHaveLength(3)
    expect(metresBetween(P, framed[0]!)).toBeLessThan(metresBetween(P, framed[1]!))
    expect(framed.some((f) => metresBetween(P, f) > 3000)).toBe(false)
  })
  it('caps the count and returns nothing when no car is close', () => {
    const many = Array.from({ length: 12 }, (_, i) => car(`d${i}`, north(100 + i * 50)))
    expect(carsToFrame(P, many)).toHaveLength(5)
    expect(carsToFrame(P, [car('far', north(9000))])).toEqual([])
    expect(carsToFrame(P, [])).toEqual([])
  })
})

describe('carStep', () => {
  it('ignores GPS jitter', () => {
    expect(carStep(P, north(1))).toEqual({ kind: 'stay' })
  })
  it('glides a normal move and turns the car the way it moved', () => {
    const s = carStep(P, north(60))
    expect(s.kind).toBe('glide')
    expect(s.kind === 'glide' && Math.round(s.heading ?? -1)).toBe(0)
  })
  it('glides a short move without changing the heading (too small to trust)', () => {
    expect(carStep(P, north(5))).toEqual({ kind: 'glide', heading: null })
  })
  it('snaps a jump that is not driving', () => {
    expect(carStep(P, north(MAX_GLIDE_METRES + 500))).toEqual({ kind: 'snap' })
  })
})

describe('fadeOpacity', () => {
  it('starts dim, fades steadily and is gone at the last step', () => {
    expect(fadeOpacity(0)).toBeGreaterThan(0)
    expect(fadeOpacity(1)).toBeLessThan(fadeOpacity(0))
    expect(fadeOpacity(FADE_STEPS - 1)).toBeGreaterThan(0)
    expect(fadeOpacity(FADE_STEPS)).toBe(0)
    expect(fadeOpacity(FADE_STEPS + 3)).toBe(0)
  })
  it('never goes negative or above the starting opacity', () => {
    expect(fadeOpacity(-2)).toBe(fadeOpacity(0))
    expect(fadeOpacity(0, 0)).toBe(0)
  })
})
