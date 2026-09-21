import { describe, expect, it } from 'vitest'
import { filterRidesByTab } from './filterRidesByTab'
import type { RideHistoryItem } from '@ocar/mobile-shared'

function ride(id: string, status: string): RideHistoryItem {
  return {
    id,
    status,
    rideType: 'one_way',
    originAddress: 'A',
    destinationAddress: 'B',
    requestedAt: '2026-09-01T10:00:00.000Z',
    completedAt: null,
    driverName: null,
    fare: null,
  }
}

const rides = [ride('1', 'completed'), ride('2', 'cancelled'), ride('3', 'completed'), ride('4', 'no_drivers')]

describe('filterRidesByTab', () => {
  it("'all' returns every ride, unfiltered", () => {
    expect(filterRidesByTab(rides, 'all')).toEqual(rides)
  })

  it("'upcoming' also passes the list through unfiltered -- upcoming rides are a separate fetch, not a status filter of history", () => {
    expect(filterRidesByTab(rides, 'upcoming')).toEqual(rides)
  })

  it("'completed' keeps only completed-status rides", () => {
    expect(filterRidesByTab(rides, 'completed').map((r) => r.id)).toEqual(['1', '3'])
  })

  it("'cancelled' keeps only cancelled-status rides (does not fold in no_drivers)", () => {
    expect(filterRidesByTab(rides, 'cancelled').map((r) => r.id)).toEqual(['2'])
  })

  it('returns an empty array when nothing matches the tab', () => {
    expect(filterRidesByTab([ride('1', 'in_progress')], 'completed')).toEqual([])
  })
})
