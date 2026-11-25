import { describe, it, expect, vi, beforeEach } from 'vitest'

// A driver who took an advance ride and then drops out before the trip starts: the ride goes back to being searched for instead of being
// cancelled on the rider.
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: async () => client } }))
vi.mock('@/db/redis', () => ({ client: {}, getJSON: vi.fn(), setWithTTL: vi.fn(), withTimeout: vi.fn(async (p: Promise<unknown>) => p) }))
const q = vi.hoisted(() => ({ getJob: vi.fn(), add: vi.fn(async () => ({ id: 'j' })) }))
vi.mock('@/jobs/queues', () => ({ queues: { scheduler: q, dispatch: q }, QUEUE_NAMES: { SCHEDULER: 'scheduler', DISPATCH: 'dispatch' } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
const inc = vi.hoisted(() => vi.fn())
vi.mock('@/observability/metrics', () => ({ advanceBookingEventsTotal: { inc } }))
vi.mock('@/modules/offers/settlement', () => ({ releaseForRide: vi.fn() }))
const notify = vi.hoisted(() => ({ notifyOwner: vi.fn(async () => undefined), notifyAllAdmins: vi.fn(async () => undefined) }))
vi.mock('@/modules/notifications/notifications.service', () => notify)
const sock = vi.hoisted(() => ({ sendRideStatusUpdate: vi.fn() }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: sock }))
vi.mock('@/modules/rides/request-expiry', () => ({ expireRideRequests: vi.fn() }))
const policy = vi.hoisted(() => ({ value: { lateCancelEnabled: false, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 } }))
vi.mock('@/lib/advance-policy', async (orig) => ({ ...(await orig<object>()), getAdvancePolicy: async () => policy.value }))
const repo = vi.hoisted(() => ({ getDriversWhoLeftRide: vi.fn(async () => [] as bigint[]) }))
vi.mock('@/modules/rides/rides.repository', () => repo)

import { redispatchAfterDriverCancel, advanceMessages } from '@/modules/rides/advance.service'

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const ride = (over: Record<string, unknown> = {}) => ({
  id: '7', user_id: '9', status: 'accepted', scheduled_for: minutesFromNow(12), category_id: '2', origin_lat: 20.3, origin_lng: 85.8,
  ride_type: 'one_way', is_return_cab: false, dest_lat: 20.4, dest_lng: 85.9, trip_hours: null, ...over,
})
const sqls = () => client.query.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  client.query.mockResolvedValue({ rowCount: 1, rows: [] })
  repo.getDriversWhoLeftRide.mockResolvedValue([5n])
  policy.value = { lateCancelEnabled: false, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 }
})

describe('redispatchAfterDriverCancel', () => {
  it('puts an accepted advance ride back to searching: no driver, same booking, the driver freed, the cancel never recorded as a cancellation', async () => {
    expect(await redispatchAfterDriverCancel(ride(), 5n, 'vehicle_issue', 'flat tyre')).toBe(true)
    const all = sqls().join('\n')
    expect(all).toMatch(/UPDATE rides SET status = 'requested', driver_id = NULL, accepted_at = NULL, driver_arrived_at = NULL/)
    expect(all).toMatch(/UPDATE driver_sessions SET status = 'online'/)
    expect(all).toMatch(/UPDATE driver_location_snapshots SET is_available = true/)
    expect(all).toMatch(/INSERT INTO ride_status_history/)
    // a cancellation row is one per ride (UNIQUE): writing one here would break a later real cancellation, and the ride is not cancelled
    expect(all).not.toMatch(/ride_cancellations/)
    expect(all).not.toMatch(/status = 'cancelled', cancelled_at = now\(\), updated_at/)
    expect(client.query.mock.calls.find((c) => /INSERT INTO ride_status_history/.test(String(c[0])))![1]).toEqual([7n, 'accepted', 5n, expect.stringContaining('flat tyre')])
    expect(inc).toHaveBeenCalledWith({ event: 'driver_cancel_redispatch' })
  })

  it('tells the rider (reassuringly) and ops, and moves the rider app back to searching', async () => {
    await redispatchAfterDriverCancel(ride(), 5n, 'vehicle_issue')
    expect(sock.sendRideStatusUpdate).toHaveBeenCalledWith('7', { status: 'requested', reason: 'driver_cancelled_redispatch' })
    expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_driver_cancelled', ownerId: 9n }))
    expect(notify.notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_driver_cancelled', rideId: 7n }))
    const msg = advanceMessages.driverCancelled(new Date())
    expect(msg.body).toMatch(/finding you another one/i)
    expect(msg.body).toMatch(/do not need to do anything/i)
  })

  it('queues three fresh broadcast rounds, with ids that cannot clash with the first dispatch', async () => {
    await redispatchAfterDriverCancel(ride(), 5n)
    const adds = q.add.mock.calls as unknown as Array<[string, Record<string, unknown>, { jobId: string; delay: number }]>
    expect(adds.map((c) => c[0])).toEqual(['broadcast_ride', 'broadcast_ride', 'broadcast_ride'])
    expect(adds.map((c) => c[1]['broadcastRound'])).toEqual([1, 2, 3])
    expect(adds.map((c) => c[2].jobId)).toEqual(['round-7-1-x1', 'round-7-2-x1', 'round-7-3-x1'])
    expect(adds.map((c) => c[2].delay)).toEqual([0, 25_000, 50_000])
  })

  it('also works after the driver has arrived (the rider is at the pickup and still needs a car)', async () => {
    expect(await redispatchAfterDriverCancel(ride({ status: 'driver_arrived' }), 5n)).toBe(true)
    expect(client.query.mock.calls.find((c) => /INSERT INTO ride_status_history/.test(String(c[0])))![1][1]).toBe('driver_arrived')
  })

  it('still works shortly after the pickup time, within the admin search grace', async () => {
    expect(await redispatchAfterDriverCancel(ride({ scheduled_for: minutesFromNow(-4) }), 5n)).toBe(true)
  })

  it('does NOT apply once the pickup time is long gone (cancels as before), or when the grace is off and the time has passed', async () => {
    expect(await redispatchAfterDriverCancel(ride({ scheduled_for: minutesFromNow(-30) }), 5n)).toBe(false)
    policy.value = { ...policy.value, searchGraceMin: 0 }
    expect(await redispatchAfterDriverCancel(ride({ scheduled_for: minutesFromNow(-1) }), 5n)).toBe(false)
    expect(client.query).not.toHaveBeenCalled()
  })

  it('does NOT apply to an ordinary (not advance) ride, or to a ride that has no driver on it', async () => {
    expect(await redispatchAfterDriverCancel(ride({ scheduled_for: null }), 5n)).toBe(false)
    expect(await redispatchAfterDriverCancel(ride({ status: 'in_progress' }), 5n)).toBe(false)
    expect(await redispatchAfterDriverCancel(ride({ status: 'requested' }), 5n)).toBe(false)
    expect(client.query).not.toHaveBeenCalled()
    expect(q.add).not.toHaveBeenCalled()
  })

  it('refuses (and rolls back) when the ride changed under it, queueing nothing', async () => {
    client.query.mockImplementation(async (sql: string) => (/UPDATE rides SET status = 'requested'/.test(sql) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] }))
    await expect(redispatchAfterDriverCancel(ride(), 5n)).rejects.toMatchObject({ httpStatus: 409 })
    expect(sqls().some((s) => /ROLLBACK/.test(s))).toBe(true)
    expect(q.add).not.toHaveBeenCalled()
    expect(notify.notifyOwner).not.toHaveBeenCalled()
  })

  it('a failing notice never undoes the re-dispatch', async () => {
    notify.notifyOwner.mockRejectedValueOnce(new Error('push down'))
    notify.notifyAllAdmins.mockRejectedValueOnce(new Error('push down'))
    expect(await redispatchAfterDriverCancel(ride(), 5n)).toBe(true)
    expect(q.add).toHaveBeenCalledTimes(3)
  })
})
