import { describe, it, expect } from 'vitest'
import { ago, channelLabel, keyFacts, rideSituation, rideSummaryText, riderRating, tabsFor, timelineEvents, tripDurationMs, FORCE_CONSEQUENCE, type RideLike } from '../ride-situation'

const NOW = new Date('2026-11-23T10:00:00Z').getTime()
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()
const minAhead = (m: number) => new Date(NOW + m * 60_000).toISOString()

const base = (over: Record<string, unknown> = {}): RideLike => ({
  id: '77', status: 'completed', ride_type: 'one_way', is_return_cab: false, origin_address: 'Airport', destination_address: 'Cuttack', requested_at: minAgo(120),
  accepted_at: null, driver_arrived_at: null, started_at: null, completed_at: null, review_flagged_at: null, review_reason: null, cash_discrepancy: false, cash_collected_amount: null,
  user_name: 'Anita Rout', user_phone: '+919437000001', driver_name: 'Ravi Das', driver_phone: '+919437000010', fare: '1850', payment_status: null, payment_channel: null,
  cancellation_reason_code: null, cancellation_reason: null, cancellation_actor: null, ...over,
} as unknown as RideLike)

describe('ago / tripDurationMs', () => {
  it('reads time in words', () => {
    expect(ago(minAgo(0.2), NOW)).toBe('just now')
    expect(ago(minAgo(12), NOW)).toBe('12m ago')
    expect(ago(minAgo(130), NOW)).toBe('2h 10m ago')
    expect(ago(null, NOW)).toBe('')
  })
  it('measures a finished trip and a running one', () => {
    expect(tripDurationMs(base({ started_at: minAgo(60), completed_at: minAgo(13) }), NOW)).toBe(47 * 60_000)
    expect(tripDurationMs(base({ started_at: minAgo(30) }), NOW)).toBe(30 * 60_000)
    expect(tripDurationMs(base(), NOW)).toBeNull()
  })
})

describe('rideSituation: every state says what it means', () => {
  it('completed: time, distance, what was paid, the rating', () => {
    const s = rideSituation(base({ started_at: minAgo(60), completed_at: minAgo(13), actual_km: '41.8', payment_status: 'paid', payment_channel: 'online_upi', ratings: [{ direction: 'user_to_driver', score: 5, comment: 'Smooth' }] }), NOW)
    expect(s.tone).toBe('success')
    expect(s.headline).toBe('Completed in 47m · 41.8 km')
    expect(rideSituation(base({ started_at: minAgo(60), completed_at: minAgo(13), estimated_km: '40' }), NOW).headline).toBe('Completed in 47m · ~40.0 km') // an estimate is never passed off as driven
    expect(s.lines).toEqual(['₹1,850 paid by UPI.', 'Rider rated the driver 5★: “Smooth”.'])
  })

  it('in progress and flagged: danger, how long the signal has been gone when the last ping is known, and the safe next step', () => {
    const s = rideSituation(base({ status: 'in_progress', started_at: minAgo(62), review_flagged_at: minAgo(10), review_reason: 'gps_stale' }), NOW, { lastSignalAt: minAgo(12) })
    expect(s.tone).toBe('danger')
    expect(s.headline).toBe('Possibly stuck: no signal from the driver for 12m')
    expect(s.lines).toContain('The trip has been running for 1h 2m.')
    expect(s.lines.join(' ')).toContain('If you cannot reach them, resolve the ride from More.')
    expect(s.suggested[0]).toBe('call_driver')
    expect(s.suggested).not.toContain('force_complete' as never) // destructive actions are never suggested
  })

  it('in progress and flagged without a ping: falls back to when it was flagged and why', () => {
    expect(rideSituation(base({ status: 'in_progress', started_at: minAgo(60), review_flagged_at: minAgo(10), review_reason: 'gps_stale' }), NOW).headline).toBe('Possibly stuck: flagged 10m ago (gps stale)')
  })

  it('in progress and healthy: info, with the booked length', () => {
    const s = rideSituation(base({ status: 'in_progress', started_at: minAgo(30), estimated_min: '50' }), NOW)
    expect(s.tone).toBe('info')
    expect(s.headline).toBe('Trip in progress for 30m')
    expect(s.lines).toEqual(['Booked for about 50 min.'])
  })

  it('no drivers: danger, with who was asked and what happened to each', () => {
    const offers = [{ status: 'declined' }, { status: 'expired' }, { status: 'expired' }] as never
    const s = rideSituation(base({ status: 'no_drivers', driver_name: null, offers }), NOW)
    expect(s.tone).toBe('danger')
    expect(s.lines[0]).toBe('3 drivers asked: 1 declined, 2 did not respond.')
    expect(s.suggested[0]).toBe('open_dispatch')
  })

  it('no drivers and nobody asked says why that happens', () => {
    expect(rideSituation(base({ status: 'no_drivers', offers: [] }), NOW).lines[0]).toContain('nobody suitable was online')
  })

  it('searching turns red after five minutes', () => {
    expect(rideSituation(base({ status: 'requested', dispatch_at: minAgo(2) }), NOW).tone).toBe('warning')
    const long = rideSituation(base({ status: 'requested', dispatch_at: minAgo(8) }), NOW)
    expect(long.tone).toBe('danger')
    expect(long.headline).toBe('Looking for a driver for 8m')
  })

  it('scheduled: when the pickup is and when search starts', () => {
    const s = rideSituation(base({ status: 'scheduled', driver_name: null, scheduled_for: minAhead(300), dispatch_at: minAhead(285) }), NOW)
    expect(s.tone).toBe('info')
    expect(s.headline).toMatch(/^Pickup booked for /)
    expect(s.lines[0]).toMatch(/^Driver search starts in 4h 45m/)
  })

  it('accepted and arrived name the driver and how long ago', () => {
    expect(rideSituation(base({ status: 'accepted', accepted_at: minAgo(6) }), NOW).headline).toBe('Ravi Das accepted 6m ago and is on the way')
    const a = rideSituation(base({ status: 'driver_arrived', driver_arrived_at: minAgo(4), pickup_wait_min: '3.2', pickup_free_wait_min: 5 }), NOW)
    expect(a.headline).toBe('Ravi Das reached the pickup 4m ago')
    expect(a.lines[0]).toBe('Has waited about 3 min at the pickup (5 free).')
  })

  it('cancelled: who, why, and whether the rider paid', () => {
    const free = rideSituation(base({ status: 'cancelled', cancellation_actor: 'user', cancellation_reason_code: 'changed_mind' }), NOW)
    expect(free.headline).toBe('Cancelled by the rider')
    expect(free.lines).toEqual(['Reason: Changed mind.', 'No fee charged.'])
    const paid = rideSituation(base({ status: 'cancelled', cancellation_actor: 'user', cancellation_fee_applicable: true, cancellation_fee_amount: '62', cancellation_fee_waived: false }), NOW)
    expect(paid.tone).toBe('warning')
    expect(paid.lines).toContain('₹62 cancellation fee charged.')
    const waived = rideSituation(base({ status: 'cancelled', cancellation_actor: 'admin', cancellation_fee_applicable: true, cancellation_fee_amount: '62', cancellation_fee_waived: true, cancellation_fee_waived_reason: 'driver was late' }), NOW)
    expect(waived.headline).toBe('Cancelled by Ocar support')
    expect(waived.lines).toContain('A ₹62 fee was waived: driver was late.')
    expect(waived.tone).toBe('neutral')
  })

  it('an SOS outranks everything and says where to look; a cash mismatch is called out in rupees', () => {
    const sos = rideSituation(base({ status: 'in_progress', started_at: minAgo(20), sos_triggered: true, sos_triggered_at: minAgo(3) }), NOW)
    expect(sos.tone).toBe('danger')
    expect(sos.lines[0]).toBe('SOS raised 3m ago. Check the Safety tab.')
    const cash = rideSituation(base({ status: 'completed', started_at: minAgo(60), completed_at: minAgo(10), cash_discrepancy: true, cash_collected_amount: '1500' }), NOW)
    expect(cash.tone).toBe('warning')
    expect(cash.lines.at(-1)).toBe('Cash mismatch: the driver collected ₹1,500 against a ₹1,850 fare.')
  })

  it('never yields an empty headline, whatever the status', () => {
    expect(rideSituation(base({ status: 'weird_new_status' }), NOW).headline).toBe('weird new status')
  })
})

describe('keyFacts', () => {
  it('shows only what the ride has, at most four', () => {
    const f = keyFacts(base({ started_at: minAgo(60), completed_at: minAgo(13), actual_km: '41.8', payment_status: 'paid', payment_channel: 'online_upi' }), NOW)
    expect(f.map(x => `${x.label}: ${x.value}`)).toEqual(['Fare: ₹1,850', 'Distance: 41.8 km', 'Duration: 47m', 'Payment: UPI'])
    expect(f[0]?.hint).toBe('paid')
  })
  it('an unstarted ride shows estimates, labelled as such', () => {
    const f = keyFacts(base({ status: 'requested', fare: '620', estimated_km: '12.5', estimated_min: '30' }), NOW)
    expect(f.map(x => x.hint)).toEqual(['estimate', 'estimated', 'estimated'])
  })
  it('a cash mismatch replaces the payment fact and is red', () => {
    const f = keyFacts(base({ cash_discrepancy: true }), NOW)
    expect(f.at(-1)).toMatchObject({ label: 'Payment', value: 'Cash mismatch', tone: 'danger' })
  })
})

describe('tabsFor', () => {
  it('always has Overview, Money and Activity; Safety only when there is something', () => {
    expect(tabsFor(base()).map(t => t.id)).toEqual(['overview', 'money', 'activity'])
    expect(tabsFor(base({ disputes: [{ id: '1' }] })).map(t => t.id)).toEqual(['overview', 'money', 'activity', 'safety'])
    expect(tabsFor(base({ sos_triggered: true })).find(t => t.id === 'safety')?.alert).toBe(true)
  })
  it('flags Money for a cash mismatch and counts chat messages on Activity', () => {
    const t = tabsFor(base({ cash_discrepancy: true, messages: [{ id: '1' }, { id: '2' }] }))
    expect(t.find(x => x.id === 'money')?.alert).toBe(true)
    expect(t.find(x => x.id === 'activity')?.count).toBe(2)
  })
})

describe('rideSummaryText / helpers', () => {
  it('is a short pasteable summary with the state in words and the link', () => {
    const t = rideSummaryText(base({ status: 'cancelled', cancellation_actor: 'user', category_name: 'Sedan' }), NOW, 'https://admin.example/rides?ride=77')
    expect(t).toContain('Ride #77 · cancelled · Sedan')
    expect(t).toContain('Rider: Anita Rout +919437000001')
    expect(t).toContain('Route: Airport → Cuttack')
    expect(t).toContain('Status: Cancelled by the rider. No fee charged.')
    expect(t.endsWith('https://admin.example/rides?ride=77')).toBe(true)
  })
  it('names payment channels and the rider rating', () => {
    expect(channelLabel('online_upi')).toBe('UPI')
    expect(channelLabel(null)).toBeNull()
    expect(riderRating(base({ ratings: [{ direction: 'driver_to_user', score: 3, comment: null }] }))).toBeNull()
  })
  it('states the real consequence of each forced outcome', () => {
    expect(FORCE_CONSEQUENCE.complete).toContain('finalised at the booked estimate')
    expect(FORCE_CONSEQUENCE.cancel).toContain('not charged a fare')
  })
})

describe('timelineEvents', () => {
  it('merges the status history with the ride own timestamps, in order, with the pause before each step', () => {
    const r = base({
      requested_at: minAgo(60), accepted_at: minAgo(55), started_at: minAgo(40), completed_at: minAgo(10),
      status_history: [{ from_status: null, to_status: 'requested', actor: 'user', note: null, created_at: minAgo(60) }, { from_status: 'requested', to_status: 'accepted', actor: 'driver', note: null, created_at: minAgo(55) }],
    })
    const ev = timelineEvents(r)
    expect(ev.map(e => e.label)).toEqual(['requested', 'accepted', 'trip started', 'completed']) // no duplicate "accepted": the history already has it
    expect(ev.map(e => e.gapMin)).toEqual([null, 5, 15, 30])
    expect(ev[1]).toMatchObject({ actor: 'driver' })
    expect(ev[2]).toMatchObject({ actor: null })
  })
  it('a ride with no history still has its basic steps', () => {
    expect(timelineEvents(base({ requested_at: minAgo(5) })).map(e => e.label)).toEqual(['requested'])
  })
})
