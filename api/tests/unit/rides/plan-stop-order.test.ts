import { describe, it, expect, vi } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(), query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(), expire: vi.fn(), del: vi.fn() } }))

import { planStopOrder } from '@/modules/rides/rides.service'

// Points along a north-south line, ~1.1 km apart per 0.01 deg lat.
const at = (id: string, sequence: number, lat: number, status = 'pending') => ({ id, sequence, lat, lng: 85, status })
const ORIGIN = { lat: 20.0, lng: 85 }

describe('planStopOrder', () => {
  it('moves a late-added nearer stop ahead of a farther one before pickup', () => {
    const moves = planStopOrder([at('a', 1, 20.3), at('b', 2, 20.1)], ORIGIN, false)
    expect(moves).toEqual([{ id: 'b', sequence: 1 }, { id: 'a', sequence: 2 }])
  })

  it('never moves the first pending stop once the trip is under way', () => {
    const moves = planStopOrder([at('a', 1, 20.3), at('b', 2, 20.2), at('c', 3, 20.1)], ORIGIN, true)
    // a is locked; from a (20.3) the nearest is b (20.2), then c.
    expect(moves).toEqual([])
  })

  it('keeps resolved stops on their sequences and reuses only pending ones', () => {
    const moves = planStopOrder(
      [at('r', 1, 20.05, 'reached'), at('a', 2, 20.4), at('b', 3, 20.6), at('c', 4, 20.5)],
      ORIGIN, true)
    expect(moves).toEqual([{ id: 'c', sequence: 3 }, { id: 'b', sequence: 4 }])
  })

  it('does nothing for fewer than two movable stops', () => {
    expect(planStopOrder([at('a', 1, 20.3)], ORIGIN, false)).toEqual([])
    expect(planStopOrder([at('a', 1, 20.3), at('b', 2, 20.1)], ORIGIN, true)).toEqual([])
  })
})
