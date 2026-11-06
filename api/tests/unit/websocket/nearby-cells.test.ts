import { describe, it, expect } from 'vitest'
import { CELLS_PER_DEG, GUARANTEED_RADIUS_M, NEARBY_ROOM_PREFIX, cellOf, roomOfPoint, roomsAround } from '@/websocket/nearby-cells'

// Value: protects=a searching rider hears every available car within 3.5 km of the pickup, and only cars near it;
// fails_when=the cell maths drifts between publisher and listener, a car at a cell edge falls outside the listened block, or
// southern/western coordinates round the wrong way; why_new=live nearby-cars push; seam=none (pure maths);
// no_claim=Redis or socket delivery.
const M_PER_DEG = 111_320

// A small seeded generator, so the coverage property below is reproducible.
function rng(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
}

describe('cellOf / roomOfPoint', () => {
  it('puts a point in the cell its coordinates floor to, with exact integer indices', () => {
    expect(cellOf(20.3, 85.8)).toEqual({ i: Math.floor(20.3 * CELLS_PER_DEG), j: Math.floor(85.8 * CELLS_PER_DEG) })
    expect(roomOfPoint(20.3, 85.8)).toBe(`${NEARBY_ROOM_PREFIX}1015:4290`)
  })
  it('floors toward negative infinity, so cells south and west of 0 are not folded onto the ones north and east of it', () => {
    expect(cellOf(-0.001, -0.001)).toEqual({ i: -1, j: -1 })
    expect(cellOf(0.001, 0.001)).toEqual({ i: 0, j: 0 })
  })
  it('two points a metre apart in the same cell share a room; across a cell edge they do not', () => {
    const edge = 20.34 // 20.34 * 50 = 1017 exactly: a cell boundary
    expect(roomOfPoint(edge + 1 / M_PER_DEG, 85.8)).not.toBe(roomOfPoint(edge - 1 / M_PER_DEG, 85.8))
    expect(roomOfPoint(edge + 1 / M_PER_DEG, 85.8)).toBe(roomOfPoint(edge + 50 / M_PER_DEG, 85.8))
  })
})

describe('roomsAround', () => {
  it('is the 5x5 block of cells centred on the pickup\'s own cell: 25 distinct rooms including the pickup\'s', () => {
    const rooms = roomsAround(20.2961, 85.8245)
    expect(rooms).toHaveLength(25)
    expect(new Set(rooms).size).toBe(25)
    expect(rooms).toContain(roomOfPoint(20.2961, 85.8245))
    expect(rooms.every((r) => r.startsWith(NEARBY_ROOM_PREFIX))).toBe(true)
  })

  it('covers every car within the guaranteed radius of the pickup, wherever in the cell the pickup is and at any latitude in India', () => {
    const next = rng(42)
    for (let n = 0; n < 4000; n++) {
      const lat = 8 + next() * 29 // 8N .. 37N
      const lng = 68 + next() * 30
      const bearing = next() * 2 * Math.PI
      const dist = next() * GUARANTEED_RADIUS_M
      const carLat = lat + (dist * Math.cos(bearing)) / M_PER_DEG
      const carLng = lng + (dist * Math.sin(bearing)) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
      expect(roomsAround(lat, lng), `pickup ${lat},${lng} car ${dist | 0} m away`).toContain(roomOfPoint(carLat, carLng))
    }
  })

  it('does not listen to a far-away area (a rider cannot hear a city across the state)', () => {
    const rooms = new Set(roomsAround(20.2961, 85.8245))
    expect(rooms.has(roomOfPoint(20.4625, 85.883))).toBe(false) // Cuttack, ~20 km away
  })
})
