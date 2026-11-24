import { describe, it, expect } from 'vitest'
import { activeCount, elapsedLabel, handledBy, hasLocation, timeline, totalCount, unannounced, waitingClock, waitingTone } from '../sos-model'

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

describe('waiting clock and tone', () => {
  it('counts up as m:ss then h:mm:ss', () => {
    expect(waitingClock(ago(0), NOW)).toBe('0:00')
    expect(waitingClock(new Date(NOW - 252_000).toISOString(), NOW)).toBe('4:12')
    expect(waitingClock(new Date(NOW - 3_725_000).toISOString(), NOW)).toBe('1:02:05')
  })
  it('is ok under a minute, late to five, overdue after', () => {
    expect(waitingTone(ago(0.5), NOW)).toBe('ok')
    expect(waitingTone(ago(1), NOW)).toBe('late')
    expect(waitingTone(ago(4.9), NOW)).toBe('late')
    expect(waitingTone(ago(5), NOW)).toBe('overdue')
  })
})

describe('unannounced', () => {
  const a = (id: string, status = 'triggered') => ({ id, status })
  it('stays silent on the first load but remembers what is there', () => {
    const r = unannounced(null, [a('1'), a('2')])
    expect(r.ids).toEqual([])
    expect([...r.seen]).toEqual(['1', '2'])
  })
  it('reports only new, still-unacknowledged alerts, once', () => {
    const first = unannounced(null, [a('1')])
    const second = unannounced(first.seen, [a('1'), a('2'), a('3', 'acknowledged')])
    expect(second.ids).toEqual(['2'])
    expect(unannounced(second.seen, [a('1'), a('2')]).ids).toEqual([])
  })
})

describe('timeline', () => {
  it('tells the story oldest first', () => {
    const t = timeline({
      created_at: ago(10), acknowledged_at: ago(8), acknowledged_by_email: 'a@x.com', resolved_at: ago(2),
      resolved_by_email: 'b@x.com', status: 'false_alarm', resolution_note: 'pressed by mistake', triggered_by_driver: null,
    })
    expect(t.map(e => e.text)).toEqual(['Rider pressed SOS', 'Acknowledged by a@x.com', 'Dismissed as a false alarm by b@x.com: pressed by mistake'])
  })
})
