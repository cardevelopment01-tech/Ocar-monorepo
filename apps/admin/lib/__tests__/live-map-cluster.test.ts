import { describe, it, expect } from 'vitest'
import { clusterPoints, inView, CLUSTER_BELOW_ZOOM, type ClusterPoint } from '../live-map-cluster'

const pt = (id: string, lat: number, lng: number, over: Partial<ClusterPoint> = {}): ClusterPoint => ({ id, lat, lng, stage: 'idle', pinned: false, ...over })

describe('clusterPoints', () => {
  it('draws every driver at or past the cluster zoom', () => {
    const pts = [pt('a', 20.3, 85.8), pt('b', 20.3001, 85.8001)]
    expect(clusterPoints(pts, CLUSTER_BELOW_ZOOM)).toEqual({ singles: ['a', 'b'], clusters: [] })
  })

  it('merges drivers that are close together when zoomed out', () => {
    const r = clusterPoints([pt('a', 20.3, 85.8), pt('b', 20.3005, 85.8005), pt('c', 20.3008, 85.8002)], 11)
    expect(r.singles).toEqual([])
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0]).toMatchObject({ count: 3, ids: ['a', 'b', 'c'] })
  })

  it('keeps drivers that are far apart separate', () => {
    const r = clusterPoints([pt('a', 20.3, 85.8), pt('puri', 19.8, 85.83)], 11)
    expect(r.clusters).toEqual([])
    expect(r.singles.sort()).toEqual(['a', 'puri'])
  })

  it('a lone driver in its cell stays a single, not a cluster of one', () => {
    const r = clusterPoints([pt('a', 20.3, 85.8), pt('b', 20.3003, 85.8003), pt('far', 21.5, 86.9)], 7)
    expect(r.singles).toEqual(['far'])
    expect(r.clusters).toHaveLength(1)
  })

  it('never merges a pinned driver (selected, or on a trip with no location)', () => {
    const r = clusterPoints([pt('a', 20.3, 85.8), pt('b', 20.3003, 85.8003, { pinned: true }), pt('c', 20.3004, 85.8004)], 10)
    expect(r.singles).toEqual(['b'])
    expect(r.clusters[0]).toMatchObject({ count: 2, ids: ['a', 'c'] })
  })

  it('splits clusters apart as the map zooms in', () => {
    // 0.03 degrees is a couple of pixels at zoom 6 but well over one cell (64 px) at zoom 13, where two points that far apart can never share one.
    const pts = [pt('a', 20.3, 85.8), pt('b', 20.33, 85.83)]
    expect(clusterPoints(pts, 6).clusters).toHaveLength(1)
    expect(clusterPoints(pts, 13).clusters).toHaveLength(0)
  })

  it('places the cluster at the average and reports the box that holds its drivers', () => {
    const c = clusterPoints([pt('a', 20.30, 85.80), pt('b', 20.32, 85.82)], 5).clusters[0]!
    expect(c.lat).toBeCloseTo(20.31, 6)
    expect(c.lng).toBeCloseTo(85.81, 6)
    expect(c.bounds).toEqual({ north: 20.32, south: 20.30, east: 85.82, west: 85.80 })
  })

  it('colours a cluster by its most urgent driver', () => {
    const r = clusterPoints([pt('a', 20.3, 85.8, { stage: 'idle' }), pt('b', 20.3001, 85.8001, { stage: 'waiting' }), pt('c', 20.3002, 85.8002, { stage: 'on_trip' })], 6)
    expect(r.clusters[0]!.stage).toBe('waiting')
    const r2 = clusterPoints([pt('a', 20.3, 85.8, { stage: 'no_location' }), pt('b', 20.3001, 85.8001, { stage: 'idle' })], 6)
    expect(r2.clusters[0]!.stage).toBe('idle')
  })

  it('loses nobody: singles plus cluster members are exactly the input', () => {
    const pts = Array.from({ length: 200 }, (_, i) => pt(`d${i}`, 20 + (i % 17) * 0.01, 85.5 + (i % 23) * 0.01, { pinned: i % 31 === 0 }))
    for (const zoom of [6, 9, 11, 13]) {
      const r = clusterPoints(pts, zoom)
      const all = [...r.singles, ...r.clusters.flatMap((c) => c.ids)]
      expect(all.length).toBe(pts.length)
      expect(new Set(all).size).toBe(pts.length)
    }
  })

  it('handles no drivers', () => expect(clusterPoints([], 8)).toEqual({ singles: [], clusters: [] }))
})

describe('inView', () => {
  const view = { north: 21, south: 20, east: 86, west: 85 }
  it('everything is in view before the map has reported its bounds', () => expect(inView(5, 5, null)).toBe(true))
  it('inside is in', () => expect(inView(20.5, 85.5, view)).toBe(true))
  it('just outside is still in, within the margin', () => expect(inView(21.2, 85.5, view)).toBe(true))
  it('far outside is out', () => {
    expect(inView(22, 85.5, view)).toBe(false)
    expect(inView(20.5, 88, view)).toBe(false)
    expect(inView(19, 85.5, view)).toBe(false)
  })
  it('handles a view that crosses the antimeridian', () => {
    const wrap = { north: 10, south: -10, east: -170, west: 170 }
    expect(inView(0, 175, wrap)).toBe(true)
    expect(inView(0, -175, wrap)).toBe(true)
    expect(inView(0, 0, wrap)).toBe(false)
  })
})
