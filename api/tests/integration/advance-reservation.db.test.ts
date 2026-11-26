import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// The driver reservation for advance bookings against a REAL Postgres with every migration applied (set TEST_DATABASE_URL; skipped otherwise):
// the migration, reserve / overlap / release, the fit check the dispatch and accept paths use, the driver's list and confirm, the reminder sweep
// and the hand-off at dispatch time. Notifications and sockets are stubbed: they are covered elsewhere.
const url = process.env['TEST_DATABASE_URL']

const notify = vi.hoisted(() => ({ notifyOwner: vi.fn(async () => undefined), notifyAllAdmins: vi.fn(async () => undefined) }))
vi.mock('@/modules/notifications/notifications.service', () => notify)
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendRideRequest: vi.fn(), sendRideStatusUpdate: vi.fn(), sendDriverAssigned: vi.fn() } }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn(async () => undefined) }))

const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

describe.skipIf(!url)('advance booking driver reservation on a real database', () => {
  let pool: typeof import('@/db/client').pool
  let repo: typeof import('@/modules/rides/rides.repository')
  let svc: typeof import('@/modules/rides/reservation.service')

  let userId: bigint
  let driverA: bigint
  let driverB: bigint
  let adminId: bigint
  const rideIds: bigint[] = []

  beforeAll(async () => {
    ;({ pool } = await import('@/db/client'))
    repo = await import('@/modules/rides/rides.repository')
    svc = await import('@/modules/rides/reservation.service')
    const u = await pool.query<{ id: string }>("INSERT INTO users (phone) VALUES ('+919999000311') ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id")
    userId = BigInt(u.rows[0]!.id)
    for (const [phone, set] of [['+919999000322', 'A'], ['+919999000333', 'B']] as const) {
      const d = await pool.query<{ id: string }>(
        "INSERT INTO drivers (phone, status, city_id) VALUES ($1, 'active', 1) ON CONFLICT (phone) DO UPDATE SET status = 'active', city_id = 1 RETURNING id", [phone])
      if (set === 'A') driverA = BigInt(d.rows[0]!.id); else driverB = BigInt(d.rows[0]!.id)
    }
    const a = await pool.query<{ id: string }>("INSERT INTO admins (email, password_hash, role) VALUES ('reservation-test@example.com', 'x', 'super_admin') ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id")
    adminId = BigInt(a.rows[0]!.id)
  })

  afterAll(async () => {
    if (!pool) return
    const ids = rideIds.map(String)
    if (ids.length) {
      await pool.query('DELETE FROM driver_reservation_events WHERE ride_id = ANY($1::bigint[])', [ids])
      await pool.query('DELETE FROM ride_status_history WHERE ride_id = ANY($1::bigint[])', [ids])
      await pool.query('DELETE FROM ride_advance_meta WHERE ride_id = ANY($1::bigint[])', [ids])
      await pool.query('DELETE FROM fare_snapshots WHERE ride_id = ANY($1::bigint[])', [ids])
      await pool.query('DELETE FROM rides WHERE id = ANY($1::bigint[])', [ids])
    }
    await pool.end()
  })

  beforeEach(() => { notify.notifyOwner.mockClear(); notify.notifyAllAdmins.mockClear() })

  // An advance booking `minutes` from now, `estMin` long, with its meta row, the way booking creates it.
  async function booking(minutes: number, estMin = 40): Promise<bigint> {
    const r = await repo.createRide({
      userId, categoryId: 2n, rideType: 'one_way', isReturnCab: false, originLat: 20.3, originLng: 85.8, originCityId: 1n,
      scheduledFor: inMin(minutes), status: 'scheduled',
    })
    const id = BigInt((r as { id: string }).id)
    rideIds.push(id)
    const client = await pool.connect()
    try {
      await repo.insertFareSnapshot(client, {
        rideId: String(id), rateCardId: null, rentalPackageId: null, rideType: 'one_way', isReturnCab: false, surgeEventId: null, surgeMultiplier: 1,
        estimatedKm: 20, estimatedMin: estMin, stopCount: 0, tripHours: 0, baseFare: 0, distanceFare: 500, timeFare: 0, stopFare: 0,
        hourSurcharge: 0, surgeFare: 0, total: 500, pricingVersion: 1, waitingFare: 0, discountAmount: 0,
      } as never)
    } finally { client.release() }
    await repo.createAdvanceMeta({ rideId: id, dispatchBufferMinutes: 15 })
    return id
  }
  const reservedOn = async (id: bigint) => (await pool.query('SELECT claimed_by_driver_id::text AS d, reservation_confirmed_at FROM ride_advance_meta WHERE ride_id = $1', [id])).rows[0]

  it('migration 164 is applied: reservation columns, the late-release table, and nothing reserved by default', async () => {
    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'ride_advance_meta' AND column_name LIKE 'reservation_%' ORDER BY 1")
    expect(cols.rows.map((r) => r.column_name)).toEqual(['reservation_confirmed_at', 'reservation_remind_30_at', 'reservation_remind_60_at', 'reservation_risk_alerted_at'])
    await expect(pool.query("INSERT INTO driver_reservation_events (driver_id, ride_id, event) VALUES (1, 1, 'nonsense')")).rejects.toThrow()
  })

  it('reserves a driver on a scheduled booking; the ride stays scheduled and the driver is told', async () => {
    const id = await booking(120)
    expect(await svc.reserveDriver(id, driverA, adminId)).toEqual({ success: true, replaced: false })
    expect((await reservedOn(id)).d).toBe(driverA.toString())
    expect((await pool.query('SELECT status FROM rides WHERE id = $1', [id])).rows[0].status).toBe('scheduled')
    expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: driverA, type: 'advance_reserved', rideId: id }))
  })

  it('refuses a ride that is not a scheduled booking, one already due, an inactive driver, and another city', async () => {
    const id = await booking(120)
    await pool.query("UPDATE rides SET status = 'cancelled' WHERE id = $1", [id])
    await expect(svc.reserveDriver(id, driverA, adminId)).rejects.toMatchObject({ httpStatus: 409, code: 'NOT_RESERVABLE' })
    const due = await booking(120)
    await pool.query("UPDATE rides SET scheduled_for = now() - interval '1 minute' WHERE id = $1", [due])
    await expect(svc.reserveDriver(due, driverA, adminId)).rejects.toMatchObject({ code: 'NOT_RESERVABLE' })
    const ok = await booking(120)
    await pool.query("UPDATE drivers SET status = 'suspended' WHERE id = $1", [driverB])
    await expect(svc.reserveDriver(ok, driverB, adminId)).rejects.toMatchObject({ httpStatus: 422, code: 'DRIVER_NOT_ACTIVE' })
    await pool.query("UPDATE drivers SET status = 'active', city_id = 2 WHERE id = $1", [driverB])
    await expect(svc.reserveDriver(ok, driverB, adminId)).rejects.toMatchObject({ code: 'DRIVER_OTHER_CITY' })
    await pool.query('UPDATE drivers SET city_id = 1 WHERE id = $1', [driverB])
  })

  it('refuses a second booking that overlaps one the driver already holds, but allows it with the override and when there is enough gap', async () => {
    const first = await booking(300, 60)        // 5 h from now, 60 min long (+20 buffer)
    await svc.reserveDriver(first, driverB, adminId)
    const clash = await booking(300 + 50, 40)   // 50 min after the first starts: inside it
    await expect(svc.reserveDriver(clash, driverB, adminId)).rejects.toMatchObject({ httpStatus: 409, code: 'RESERVATION_OVERLAP' })
    await expect(svc.reserveDriver(clash, driverB, adminId, null, true)).resolves.toMatchObject({ success: true })
    const later = await booking(300 + 200, 40)  // 200 min after: clear
    await expect(svc.reserveDriver(later, driverB, adminId)).resolves.toMatchObject({ success: true })
  })

  it('moving a booking to another driver tells the first one it was taken off them', async () => {
    const id = await booking(600)
    await svc.reserveDriver(id, driverA, adminId)
    notify.notifyOwner.mockClear()
    expect(await svc.reserveDriver(id, driverB, adminId)).toMatchObject({ replaced: true })
    const types = notify.notifyOwner.mock.calls.map((c) => [(c[0] as { ownerId: bigint }).ownerId, (c[0] as { type: string }).type])
    expect(types).toEqual([[driverA, 'advance_reserve_released'], [driverB, 'advance_reserved']])
  })

  describe('the fit check', () => {
    it('a driver with no reservation is never held back', async () => {
      const free = [{ driver_id: 987654n, distance_metres: 500 }]
      expect(await svc.dropReservationClashes(free, 30)).toEqual(free)
    })

    it('a driver reserved far ahead can take a short ride; one reserved soon cannot', async () => {
      await pool.query("DELETE FROM ride_advance_meta WHERE claimed_by_driver_id = $1 AND ride_id NOT IN (SELECT id FROM rides WHERE status <> 'scheduled')", [driverA]).catch(() => undefined)
      const id = await booking(90)                 // reserved for 90 min from now
      await svc.reserveDriver(id, driverA, adminId, null, true)
      const near = { driver_id: driverA, distance_metres: 2000 } // ~5 min to the pickup
      // 5 drive + 30 ride + 20 buffer = 55 min <= 90
      expect(await svc.dropReservationClashes([near], 30)).toHaveLength(1)
      // 5 + 70 + 20 = 95 min > 90
      expect(await svc.dropReservationClashes([near], 70)).toHaveLength(0)
      // far away: 25 km = 60 min drive + 20 + 20 = 100 > 90
      expect(await svc.dropReservationClashes([{ driver_id: driverA, distance_metres: 25_000 }], 20)).toHaveLength(0)
    })

    it('a booking that is already reserved never clashes with itself', async () => {
      const id = await booking(45)
      await svc.reserveDriver(id, driverB, adminId, null, true)
      expect((await svc.nextReservations([driverB], id)).get(driverB.toString())?.rideId).not.toBe(id.toString())
    })
  })

  describe('the driver side', () => {
    it('lists upcoming bookings soonest first, confirms them, and hands them back (late is recorded, ops told)', async () => {
      const soon = await booking(50)               // inside the last hour
      await svc.reserveDriver(soon, driverA, adminId, null, true)
      const list = await svc.listDriverReservations(driverA)
      expect(list.length).toBeGreaterThan(0)
      expect(list.map((r) => r.pickupAt)).toEqual([...list.map((r) => r.pickupAt)].sort())
      const mine = list.find((r) => r.rideId === soon.toString())!
      expect(mine).toMatchObject({ confirmed: false, canConfirm: true, handBackIsLate: true })

      await svc.confirmReservation(driverA, soon)
      expect((await reservedOn(soon)).reservation_confirmed_at).not.toBeNull()
      await expect(svc.confirmReservation(driverB, soon)).rejects.toMatchObject({ code: 'RESERVATION_GONE' })

      expect(await svc.declineReservation(driverA, soon)).toEqual({ released: true, late: true })
      expect((await reservedOn(soon)).d).toBeNull()
      const ev = await pool.query('SELECT event FROM driver_reservation_events WHERE ride_id = $1', [soon])
      expect(ev.rows.map((r) => r.event)).toEqual(['released_late'])
      expect(notify.notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_reserve_alert', rideId: soon }))
      expect((await svc.lateReleaseCounts([driverA])).get(driverA.toString())).toBeGreaterThanOrEqual(1)
    })

    it('an early decline (more than an hour ahead) is recorded as a plain decline, not a late release', async () => {
      const far = await booking(500)
      await svc.reserveDriver(far, driverA, adminId, null, true)
      expect(await svc.declineReservation(driverA, far)).toEqual({ released: true, late: false })
      expect((await pool.query('SELECT event FROM driver_reservation_events WHERE ride_id = $1', [far])).rows[0].event).toBe('declined')
    })

    it('a booking that is no longer theirs cannot be declined or confirmed', async () => {
      const id = await booking(300)
      await svc.reserveDriver(id, driverA, adminId, null, true)
      await expect(svc.declineReservation(driverB, id)).rejects.toMatchObject({ httpStatus: 409 })
    })
  })

  describe('admin release', () => {
    it('takes the reservation off (the driver is told), and says so when there was none', async () => {
      const id = await booking(400)
      await svc.reserveDriver(id, driverA, adminId, null, true)
      notify.notifyOwner.mockClear()
      expect(await svc.releaseReservation(id, 'admin', { actorId: adminId })).toMatchObject({ released: true })
      expect((await reservedOn(id)).d).toBeNull()
      expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_reserve_released', ownerId: driverA }))
      expect((await pool.query('SELECT count(*)::int AS n FROM driver_reservation_events WHERE ride_id = $1', [id])).rows[0].n).toBe(0) // an admin release is not the driver's doing
      expect(await svc.releaseReservation(id, 'admin', { actorId: adminId })).toEqual({ released: false })
    })
  })

  describe('reminders', () => {
    it('asks to confirm about an hour ahead, says "be ready" at half an hour, and each only once', async () => {
      const id = await booking(58)
      await svc.reserveDriver(id, driverA, adminId, null, true)
      notify.notifyOwner.mockClear()
      await svc.sendReservationReminders()
      const mine = () => notify.notifyOwner.mock.calls.filter((c) => (c[0] as { rideId: bigint }).rideId === id)
      expect(mine().map((c) => (c[0] as { title: string }).title)).toEqual(['Please confirm your booking'])
      await svc.sendReservationReminders()
      expect(mine()).toHaveLength(1)                                   // not twice

      await pool.query("UPDATE rides SET scheduled_for = now() + interval '28 minutes' WHERE id = $1", [id])
      await svc.sendReservationReminders()
      expect(mine().map((c) => (c[0] as { title: string }).title)).toEqual(['Please confirm your booking', 'Get ready for your booking'])
    })

    it('tells ops once when the booking is at risk (not confirmed / offline) at the ready mark', async () => {
      const id = await booking(28)
      await svc.reserveDriver(id, driverB, adminId, null, true)
      notify.notifyAllAdmins.mockClear()
      const out = await svc.sendReservationReminders()
      expect(out.atRisk).toBeGreaterThanOrEqual(1)
      expect(notify.notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'advance_reserve_alert', rideId: id }))
      notify.notifyAllAdmins.mockClear()
      await svc.sendReservationReminders()
      expect(notify.notifyAllAdmins).not.toHaveBeenCalled()
    })

    it('says nothing for a booking nobody is reserved on', async () => {
      const id = await booking(28)
      notify.notifyOwner.mockClear()
      await svc.sendReservationReminders()
      expect(notify.notifyOwner.mock.calls.filter((c) => (c[0] as { rideId: bigint }).rideId === id)).toHaveLength(0)
    })
  })

  describe('at dispatch time', () => {
    it('does nothing for a booking with no reserved driver (the normal search runs)', async () => {
      const id = await booking(10)
      await pool.query("UPDATE rides SET status = 'requested' WHERE id = $1", [id])
      const accept = vi.fn()
      expect(await svc.dispatchToReservedDriver(id, accept, vi.fn())).toBe(false)
      expect(accept).not.toHaveBeenCalled()
    })

    it('an offline reserved driver loses the booking: released, recorded, driver and ops told, search carries on', async () => {
      const id = await booking(10)
      await svc.reserveDriver(id, driverA, adminId, null, true)
      await pool.query("UPDATE driver_sessions SET status = 'offline' WHERE driver_id = $1", [driverA])
      await pool.query("UPDATE rides SET status = 'requested' WHERE id = $1", [id])
      notify.notifyOwner.mockClear(); notify.notifyAllAdmins.mockClear()
      const accept = vi.fn()
      expect(await svc.dispatchToReservedDriver(id, accept, vi.fn())).toBe(false)
      expect(accept).not.toHaveBeenCalled()
      expect((await reservedOn(id)).d).toBeNull()
      expect((await pool.query('SELECT event FROM driver_reservation_events WHERE ride_id = $1', [id])).rows[0].event).toBe('no_confirm')
      expect(notify.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerId: driverA, type: 'advance_reserve_released' }))
      expect(notify.notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ rideId: id }))
    })
  })
})
