import { describe, it, expect } from 'vitest'
import type { LiveMapAttention } from '../admin-api'
import { toAttentionItems, attentionCounts } from '../live-map-attention'

const data: LiveMapAttention = {
  sos: [
    { id: '1', ride_id: '10', severity: 'high', status: 'triggered', lat: 20.3, lng: 85.8, created_at: '2026-11-25T10:00:00Z', driver_name: 'Ramesh', rider_name: 'Asha' },
    { id: '2', ride_id: '11', severity: 'medium', status: 'acknowledged', lat: 20.4, lng: 85.9, created_at: '2026-11-25T10:01:00Z', driver_name: null, rider_name: null },
    { id: '3', ride_id: '12', severity: 'low', status: 'responding', lat: null, lng: null, created_at: '2026-11-25T10:02:00Z', driver_name: null, rider_name: null },
  ],
  flagged: [{ ride_id: '20', ride_status: 'in_progress', reason: 'gps_stale', flagged_at: '2026-11-25T09:00:00Z', driver_name: 'Tapas', lat: 20.1, lng: 85.1 }],
  requests: [
    { ride_id: '30', kind: 'searching', address: 'Airport', created_at: '2026-11-25T10:05:00Z', lat: 20.25, lng: 85.82 },
    { ride_id: '31', kind: 'no_drivers', address: null, created_at: '2026-11-25T09:50:00Z', lat: 20.26, lng: 85.83 },
  ],
}

describe('toAttentionItems', () => {
  const items = toAttentionItems(data)

  it('has nothing for no data', () => expect(toAttentionItems(null)).toEqual([]))
  it('leaves out items with no position but they stay in the counts', () => {
    expect(items.filter((i) => i.kind === 'sos')).toHaveLength(2)
    expect(attentionCounts(data)).toEqual({ sos: 3, flagged: 1, requests: 2 })
  })
  it('marks only an unacknowledged SOS as urgent', () => {
    const sos = items.filter((i) => i.kind === 'sos')
    expect(sos.map((s) => s.urgent)).toEqual([true, false])
    expect(items.filter((i) => i.kind !== 'sos').every((i) => !i.urgent)).toBe(true)
  })
  it('describes an SOS with its status, ride and people', () => {
    expect(items[0]).toMatchObject({ title: 'SOS · high', href: '/sos', linkLabel: 'Open SOS console' })
    expect(items[0]!.detail).toBe('triggered · ride 10 · rider Asha · driver Ramesh')
    expect(items[1]!.detail).toBe('acknowledged · ride 11')
  })
  it('a flagged ride links to the ride with a readable reason', () => {
    const f = items.find((i) => i.kind === 'flagged')!
    expect(f.href).toBe('/rides/20')
    expect(f.detail).toBe('ride 20 · Tapas · gps stale')
  })
  it('tells a searching request from one that found no driver', () => {
    const r = items.filter((i) => i.kind === 'request')
    expect(r.map((x) => x.title)).toEqual(['Waiting for a driver', 'No driver found'])
    expect(r[0]!.detail).toBe('ride 30 · Airport')
    expect(r[1]!.detail).toBe('ride 31')
  })
  it('gives every item a unique key', () => expect(new Set(items.map((i) => i.key)).size).toBe(items.length))

  it('only an unmet request can have a driver assigned from the map, and carries its ride', () => {
    expect(items.filter((i) => i.kind === 'request').every((i) => i.assignable && i.rideId != null)).toBe(true)
    expect(items.filter((i) => i.kind !== 'request').every((i) => !i.assignable)).toBe(true)
    expect(items.find((i) => i.key === 'request:30')!.rideId).toBe('30')
  })
})
