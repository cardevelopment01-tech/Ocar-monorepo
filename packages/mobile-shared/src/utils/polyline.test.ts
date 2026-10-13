import { describe, expect, it } from 'vitest'
import { distanceToPolylineMetres, douglasPeucker, simplifyPolyline } from './polyline'

// 0.0001 deg lat is about 11 m
const line: [number, number][] = [[20.0, 85.0], [20.0, 85.01]]

describe('distanceToPolylineMetres', () => {
  it('is ~0 on the line and grows off it', () => {
    expect(distanceToPolylineMetres([20.0, 85.005], line)).toBeLessThan(1)
    const off = distanceToPolylineMetres([20.001, 85.005], line)
    expect(off).toBeGreaterThan(100)
    expect(off).toBeLessThan(120)
  })
  it('measures to the nearest end beyond the segment', () => {
    expect(distanceToPolylineMetres([20.0, 84.99], line)).toBeGreaterThan(1000)
  })
})

describe('douglasPeucker', () => {
  it('drops collinear points but keeps a real corner', () => {
    const pts: [number, number][] = [[0, 0], [0, 0.001], [0, 0.002], [0.002, 0.002]]
    const out = douglasPeucker(pts, 4)
    expect(out).toEqual([[0, 0], [0, 0.002], [0.002, 0.002]])
  })
})

describe('simplifyPolyline', () => {
  it('keeps endpoints and shrinks a dense straight line to two points', () => {
    const pts: [number, number][] = Array.from({ length: 200 }, (_, i) => [20, 85 + i * 0.0001])
    const out = simplifyPolyline(pts)
    expect(out[0]).toEqual(pts[0])
    expect(out.at(-1)).toEqual(pts.at(-1))
    expect(out.length).toBe(2)
  })
})
