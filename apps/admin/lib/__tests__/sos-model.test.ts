import { describe, it, expect } from 'vitest'
import { activeCount, elapsedLabel, handledBy, hasLocation, totalCount } from '../sos-model'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

describe('elapsedLabel', () => {
  it.each([
    [0, 'just now'],
    [4, '4 min ago'],
    [59, '59 min ago'],
    [60, '1h ago'],
    [130, '2h 10m ago'],
    [24 * 60, '1d ago'],
    [3 * 24 * 60 + 4 * 60, '3d 4h ago'],
  ])('%i minutes is "%s"', (min, label) => expect(elapsedLabel(ago(min), NOW)).toBe(label))

  it('never goes negative when the clocks differ a little', () => expect(elapsedLabel(ago(-3), NOW)).toBe('just now'))
  it('shows a dash, not "NaN", for a missing or bad time', () => {
    expect(elapsedLabel(null, NOW)).toBe('—')
    expect(elapsedLabel('garbage', NOW)).toBe('—')
  })
})

describe('hasLocation', () => {
  it('is true for a real point', () => expect(hasLocation({ location_lat: '20.2961', location_lng: '85.8245' })).toBe(true))
  it('is false for nothing or for 0,0', () => {
    expect(hasLocation({ location_lat: null, location_lng: null })).toBe(false)
    expect(hasLocation({ location_lat: '0.0000000', location_lng: '0.0000000' })).toBe(false)
  })
})

describe('handledBy', () => {
  it('names who acknowledged an open alert', () =>
    expect(handledBy({ status: 'acknowledged', acknowledged_by_email: 'a@x.com', resolved_by_email: null })).toBe('Acknowledged by a@x.com'))
  it('is empty while nobody has picked it up', () =>
    expect(handledBy({ status: 'triggered', acknowledged_by_email: null, resolved_by_email: null })).toBe(''))
  it('names who closed it, and says dismissed for a false alarm', () => {
    expect(handledBy({ status: 'resolved', acknowledged_by_email: 'a@x.com', resolved_by_email: 'b@x.com' })).toBe('Resolved by b@x.com')
    expect(handledBy({ status: 'false_alarm', acknowledged_by_email: null, resolved_by_email: 'b@x.com' })).toBe('Dismissed by b@x.com')
  })
})

describe('counts', () => {
  const c = { triggered: 2, acknowledged: 1, responding: 0, resolved: 7, false_alarm: 3 }
  it('active is the three open states', () => expect(activeCount(c)).toBe(3))
  it('total is everything', () => expect(totalCount(c)).toBe(13))
})
