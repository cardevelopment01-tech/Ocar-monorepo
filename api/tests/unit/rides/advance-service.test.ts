import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a), connect: async () => client } }))
vi.mock('@/db/redis', () => ({ client: {}, getJSON: vi.fn(), setWithTTL: vi.fn(), withTimeout: vi.fn(async (p: Promise<unknown>) => p) }))

const q = vi.hoisted(() => ({ getJob: vi.fn(), add: vi.fn() }))
vi.mock('@/jobs/queues', () => ({ queues: { scheduler: q, dispatch: q }, QUEUE_NAMES: { SCHEDULER: 'scheduler', DISPATCH: 'dispatch' } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
vi.mock('@/observability/metrics', () => ({ advanceBookingEventsTotal: { inc: vi.fn() } }))
vi.mock('@/modules/offers/settlement', () => ({ releaseForRide: vi.fn() }))
const notify = vi.hoisted(() => ({ notifyOwner: vi.fn(async () => undefined), notifyAllAdmins: vi.fn(async () => undefined) }))
vi.mock('@/modules/notifications/notifications.service', () => notify)
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendRideStatusUpdate: vi.fn(), sendRequestExpired: vi.fn() } }))
vi.mock('@/modules/rides/request-expiry', () => ({ expireRideRequests: vi.fn() }))
const policy = vi.hoisted(() => ({ value: { lateCancelEnabled: false, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 } }))
vi.mock('@/lib/advance-policy', async (orig) => ({ ...(await orig<object>()), getAdvancePolicy: async () => policy.value }))
const repo = vi.hoisted(() => ({
  getRideCoreById: vi.fn(), getAdvanceMeta: vi.fn(), setAdvanceMetaJobId: vi.fn(), cancelAllAssignments: vi.fn(async () => []), logStatusHistory: vi.fn(async () => undefined),
}))
vi.mock('@/modules/rides/rides.repository', () => repo)

import { rescheduleAdvanceRide, adminCancelRide, sendAdvanceReminders, keepSearchingAdvance, checkPickupWindow, advanceMessages, broadcastDataFor } from '@/modules/rides/advance.service'

const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000)
const scheduledRide = (over: Record<string, unknown> = {}) => ({ id: '5', user_id: '9', status: 'scheduled', scheduled_for: hoursAhead(5).toISOString(), requested_at: new Date().toISOString(), ...over })
const meta = (over: Record<string, unknown> = {}) => ({ dispatch_buffer_minutes: 15, dispatch_job_id: 'job-1', reschedule_count: 0, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  client.query.mockResolvedValue({ rowCount: 1, rows: [] })
  policy.value = { lateCancelEnabled: false, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 }
  repo.getRideCoreById.mockResolvedValue(scheduledRide())
  repo.getAdvanceMeta.mockResolvedValue(meta())
})

describe('checkPickupWindow', () => {
  it('refuses a time under 60 minutes ahead, over 7 days ahead, or not a date', () => {
    expect(() => checkPickupWindow(hoursAhead(0.5))).toThrow(/at least 60 minutes/)
    expect(() => checkPickupWindow(hoursAhead(24 * 8))).toThrow(/7 days/)
    expect(() => checkPickupWindow(new Date('nope'))).toThrow(/Invalid/)
    expect(() => checkPickupWindow(hoursAhead(6))).not.toThrow()
  })
})

describe('rescheduleAdvanceRide', () => {
  const user = { type: 'user' as const, userId: 9n }

  it('moves the pickup, resets reminders, counts it, and repoints the existing dispatch job', async () => {
    const job = { isDelayed: async () => true, changeDelay: vi.fn(), remove: vi.fn() }
    q.getJob.mockResolvedValue(job)
    const when = hoursAhead(8).toISOString()
    const out = await rescheduleAdvanceRide(5n, when, user)
    expect(out.scheduledFor).toBe(when)
    expect(out.reschedulesLeft).toBe(2)
    const sqls = client.query.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => /UPDATE rides SET scheduled_for = \$2/.test(s))).toBe(true)
    expect(sqls.some(s => /reminder_24h_sent_at = NULL/.test(s) && /reschedule_count = reschedule_count \+ \$2/.test(s))).toBe(true)
    expect(client.query.mock.calls.find(c => /reschedule_count/.test(String(c[0])))![1]).toEqual([5n, 1])
    expect(job.changeDelay).toHaveBeenCalledTimes(1)
    expect(q.add).not.toHaveBeenCalled()
    expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_rescheduled', ownerId: 9n }))
  })

  it('queues a fresh dispatch job when the old one is gone or no longer delayed', async () => {
    q.getJob.mockResolvedValue({ isDelayed: async () => false, remove: vi.fn(async () => undefined) })
    q.add.mockResolvedValue({ id: 'job-2' })
    await rescheduleAdvanceRide(5n, hoursAhead(8).toISOString(), user)
    expect(q.add).toHaveBeenCalledWith('dispatch_scheduled_ride', { rideId: '5' }, expect.objectContaining({ attempts: 3 }))
    expect(repo.setAdvanceMetaJobId).toHaveBeenCalledWith(5n, 'job-2')
  })

  it('does not fail the reschedule when the queue is down (the sweep dispatches from scheduled_for)', async () => {
    q.getJob.mockRejectedValue(new Error('redis down'))
    await expect(rescheduleAdvanceRide(5n, hoursAhead(8).toISOString(), user)).resolves.toBeTruthy()
  })

  it('stops a rider after the configured number of changes, but not an admin', async () => {
    repo.getAdvanceMeta.mockResolvedValue(meta({ reschedule_count: 3 }))
    q.getJob.mockResolvedValue(undefined); q.add.mockResolvedValue({ id: 'j' })
    await expect(rescheduleAdvanceRide(5n, hoursAhead(8).toISOString(), user)).rejects.toMatchObject({ httpStatus: 409, code: 'RESCHEDULE_LIMIT' })
    const out = await rescheduleAdvanceRide(5n, hoursAhead(8).toISOString(), { type: 'admin', adminId: 1n, reason: 'Rider called support', ip: null })
    expect(out.reschedulesLeft).toBeNull()
    expect(client.query.mock.calls.find(c => /reschedule_count/.test(String(c[0])))![1]).toEqual([5n, 0]) // an admin change is not charged to the rider's allowance
  })

  it.each([
    ['someone else\'s ride', { user_id: '77' }, 403],
    ['a ride already in dispatch', { status: 'requested' }, 409],
    ['a ride that is not an advance booking', { scheduled_for: null }, 409],
  ])('refuses %s', async (_l, over, code) => {
    repo.getRideCoreById.mockResolvedValue(scheduledRide(over))
    await expect(rescheduleAdvanceRide(5n, hoursAhead(8).toISOString(), user)).rejects.toMatchObject({ httpStatus: code })
  })

  it('rolls back and says so when the ride left "scheduled" between the read and the write', async () => {
    client.query.mockImplementation(async (sql: string) => (/UPDATE rides SET scheduled_for/.test(sql) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] }))
    await expect(rescheduleAdvanceRide(5n, hoursAhead(8).toISOString(), user)).rejects.toMatchObject({ httpStatus: 409 })
    expect(client.query.mock.calls.map(c => String(c[0]))).toContain('ROLLBACK')
  })
})

describe('adminCancelRide', () => {
  it.each(['scheduled', 'requested', 'no_drivers'])('cancels a %s ride with the reason in history and tells the rider', async (status) => {
    repo.getRideCoreById.mockResolvedValue(scheduledRide({ status }))
    await adminCancelRide(5n, 1n, 'Rider phoned: flight cancelled', null)
    const calls = client.query.mock.calls
    expect(calls.some(c => /UPDATE rides SET status = 'cancelled'/.test(String(c[0])) && (c[1] as unknown[])[1] === status)).toBe(true)
    const cancel = calls.find(c => /INSERT INTO ride_cancellations/.test(String(c[0])))!
    expect(cancel[1]).toEqual([5n, status === 'scheduled' ? 'before_dispatch' : 'before_acceptance', 1n, 'Rider phoned: flight cancelled'])
    expect(String(cancel[0])).toMatch(/false, 0, false/) // never a fee
    expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_cancelled', body: expect.stringContaining('not been charged') }))
  })

  it.each(['accepted', 'driver_arrived', 'in_progress', 'completed'])('refuses a %s ride: a driver is involved', async (status) => {
    repo.getRideCoreById.mockResolvedValue(scheduledRide({ status }))
    await expect(adminCancelRide(5n, 1n, 'whatever reason here', null)).rejects.toMatchObject({ httpStatus: 409 })
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('sendAdvanceReminders', () => {
  it('picks rides by pickup-time window, claims each with an UPDATE that only wins once, and tells only the ones it claimed', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ ride_id: '5' }, { ride_id: '6' }] })                                              // 24h candidates
      .mockResolvedValueOnce({ rows: [{ ride_id: '5', user_id: '9', scheduled_for: hoursAhead(23.5), dispatch_buffer_minutes: 15 }] }) // claimed: only ride 5
      .mockResolvedValueOnce({ rows: [] })                                                                                // 1h candidates
    const out = await sendAdvanceReminders()
    expect(out).toEqual({ day: 1, hour: 0 })
    const sqls = poolQuery.mock.calls.map(c => String(c[0]))
    expect(sqls[0]).toMatch(/r\.status = 'scheduled' AND ram\.reminder_24h_sent_at IS NULL/)
    expect(sqls[0]).toMatch(/interval '23 hours'/)
    expect(sqls[1]).toMatch(/SET reminder_24h_sent_at = now\(\)/)
    expect(sqls[1]).toMatch(/AND ram\.reminder_24h_sent_at IS NULL/)
    expect(notify.notifyOwner).toHaveBeenCalledTimes(1)
    expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_reminder', ownerId: 9n, title: 'Your ride is tomorrow' }))
  })

  it('does nothing and runs no update when no ride is due', async () => {
    poolQuery.mockResolvedValue({ rows: [] })
    expect(await sendAdvanceReminders()).toEqual({ day: 0, hour: 0 })
    expect(poolQuery).toHaveBeenCalledTimes(2) // one candidate query per reminder kind
  })
})

describe('keepSearchingAdvance', () => {
  const data = broadcastDataFor({ id: 5, category_id: 2, origin_lat: 20.2, origin_lng: 85.8, ride_type: 'one_way', is_return_cab: false })
  const ride = (pickup: Date) => ({ id: 5, user_id: 9, scheduled_for: pickup.toISOString() })

  it('queues a new set of three rounds, tells the rider and alerts ops the first time only', async () => {
    poolQuery.mockResolvedValue({ rows: [{ first: true }] })
    q.add.mockResolvedValue({ id: 'x' })
    expect(await keepSearchingAdvance(ride(hoursAhead(0.1)), data)).toBe(true)
    expect(q.add).toHaveBeenCalledTimes(3)
    const [name, payload, opts] = q.add.mock.calls[0]!
    expect(name).toBe('broadcast_ride')
    expect(payload).toMatchObject({ broadcastRound: 1, retryCycle: 1 })
    expect(opts).toMatchObject({ jobId: 'round-5-1-c1', delay: 90_000 })
    expect(q.add.mock.calls[2]![2]).toMatchObject({ jobId: 'round-5-3-c1', delay: 140_000 })
    expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_searching' }))
    expect(notify.notifyAllAdmins).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [{ first: false }] })
    await keepSearchingAdvance(ride(hoursAhead(0.1)), { ...data, retryCycle: 1 })
    expect(q.add.mock.calls[0]![2]).toMatchObject({ jobId: 'round-5-1-c2' })
    expect(notify.notifyOwner).not.toHaveBeenCalled()
    expect(notify.notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('gives up once the grace after pickup is spent, so the ride closes as before', async () => {
    expect(await keepSearchingAdvance(ride(hoursAhead(-0.5)), data)).toBe(false) // pickup was 30 min ago, grace is 10
    expect(q.add).not.toHaveBeenCalled()
  })

  it('gives up at once when the admin set the grace to zero, and for a ride that is not an advance booking', async () => {
    policy.value = { ...policy.value, searchGraceMin: 0 }
    expect(await keepSearchingAdvance(ride(hoursAhead(0.1)), data)).toBe(false)
    policy.value = { ...policy.value, searchGraceMin: 10 }
    expect(await keepSearchingAdvance({ id: 5, user_id: 9, scheduled_for: null }, data)).toBe(false)
    poolQuery.mockResolvedValue({ rows: [] }) // no advance meta row
    expect(await keepSearchingAdvance(ride(hoursAhead(0.1)), data)).toBe(false)
    expect(q.add).not.toHaveBeenCalled()
  })
})

describe('rider messages', () => {
  const pickup = new Date('2026-11-26T13:00:00Z') // 6:30 pm in India
  it('state the pickup and when the driver search starts, in IST', () => {
    const m = advanceMessages.booked(pickup, 15)
    expect(m.body).toContain('Thu 26 Nov, 6:30 pm')
    expect(m.body).toContain('6:15 pm')
  })
  it('say the rider was not charged when nobody was found or support cancelled', () => {
    expect(advanceMessages.noDrivers(pickup).body).toContain('not been charged')
    expect(advanceMessages.cancelledByAdmin(pickup, 'flight cancelled').body).toContain('flight cancelled')
  })
})
