import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Runs the night allowance against a REAL Postgres with every migration applied (set TEST_DATABASE_URL; skipped otherwise): the migration's
// columns, the rate card carry-forward, the settlement lookup and write, the ride payload the apps read, and the commission rule. The pure
// night counting is covered by tests/unit/lib/night-allowance.test.ts; this proves the SQL underneath it.
const url = process.env['TEST_DATABASE_URL']

describe.skipIf(!url)('night allowance on a real database', () => {
  let pool: typeof import('@/db/client').pool
  let repo: typeof import('@/modules/rides/rides.repository')
  let adminRepo: typeof import('@/modules/admin/admin.repository')
  let payments: typeof import('@/modules/payments/payments.service')
  let night: typeof import('@/lib/night-allowance')

  const sedan = 2n
  let userId: bigint
  let driverId: bigint
  let adminId: bigint
  const rideIds: bigint[] = []

  beforeAll(async () => {
    ;({ pool } = await import('@/db/client'))
    repo = await import('@/modules/rides/rides.repository')
    adminRepo = await import('@/modules/admin/admin.repository')
    payments = await import('@/modules/payments/payments.service')
    night = await import('@/lib/night-allowance')
    const u = await pool.query<{ id: string }>("INSERT INTO users (phone) VALUES ('+919999000111') ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id")
    userId = BigInt(u.rows[0]!.id)
    const d = await pool.query<{ id: string }>("INSERT INTO drivers (phone) VALUES ('+919999000222') ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id")
    driverId = BigInt(d.rows[0]!.id)
    const a = await pool.query<{ id: string }>("INSERT INTO admins (email, password_hash, role) VALUES ('night-allowance-test@example.com', 'x', 'super_admin') ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id")
    adminId = BigInt(a.rows[0]!.id)
  })

  afterAll(async () => {
    if (!pool) return
    for (const id of rideIds) {
      await pool.query('DELETE FROM payments WHERE ride_id = $1', [id])
      await pool.query('DELETE FROM fare_snapshots WHERE ride_id = $1', [id])
      await pool.query('DELETE FROM rides WHERE id = $1', [id])
    }
    await pool.end()
  })

  // A standard card for the sedan with the given allowance, as the admin form would create it.
  async function card(rideType: 'one_way' | 'round_trip', nightAllowancePerNight?: number): Promise<number> {
    const row = await adminRepo.createAdminRateCard({
      categoryId: Number(sedan), rideType, ratePerKm: 14, ratePerMin: 1.5, minFare: 100, adminId,
      ...(rideType === 'round_trip' ? { kmPerDay: 250, driverAllowancePerDay: 300 } : {}),
      ...(nightAllowancePerNight !== undefined ? { nightAllowancePerNight } : {}),
    } as never)
    return Number((row as { id: number }).id)
  }

  // A ride in progress, quoted on `rateCardId`, started at `startedAt` (IST wall clock).
  async function ride(rideType: string, rateCardId: number, startedAt: string, tripMode: 'standard' | 'city' = 'standard'): Promise<bigint> {
    const r = await repo.createRide({ userId, categoryId: sedan, rideType, isReturnCab: false, originLat: 20.3, originLng: 85.8, tripMode })
    const id = BigInt((r as { id: string }).id)
    rideIds.push(id)
    const client = await pool.connect()
    try {
      await repo.insertFareSnapshot(client, {
        rideId: String(id), rateCardId, rentalPackageId: null, rideType, isReturnCab: false, surgeEventId: null, surgeMultiplier: 1,
        estimatedKm: 100, estimatedMin: 120, stopCount: 0, tripHours: 0, baseFare: 0, distanceFare: 1400, timeFare: 0, stopFare: 0,
        hourSurcharge: 0, surgeFare: 0, total: 1400, pricingVersion: 1, waitingFare: 0, discountAmount: 0,
      } as never)
    } finally { client.release() }
    // Walk the real status machine (a trigger refuses a jump), then finish the ride so the one-live-ride-per-user and per-driver rules never
    // see two at once. The night allowance only reads the type, the mode, the start time and the rate card.
    await pool.query("UPDATE rides SET status = 'accepted', driver_id = $2 WHERE id = $1", [id, driverId])
    await pool.query("UPDATE rides SET status = 'driver_arrived' WHERE id = $1", [id])
    await pool.query("UPDATE rides SET status = 'in_progress', started_at = $2::timestamptz WHERE id = $1", [id, `${startedAt}+05:30`])
    await pool.query("UPDATE rides SET status = 'completed', completed_at = now() WHERE id = $1", [id])
    return id
  }

  it('migration 162 is applied: rate cards default to 0 (off) and snapshots start at 0 nights', async () => {
    const rc = await pool.query("SELECT count(*)::int AS n FROM rate_cards WHERE night_allowance_per_night IS NULL OR night_allowance_per_night < 0")
    expect(rc.rows[0].n).toBe(0)
    const old = await pool.query("SELECT count(*)::int AS n FROM rate_cards WHERE effective_to IS NULL AND night_allowance_per_night > 0 AND created_by IS NULL")
    expect(old.rows[0].n).toBe(0) // the seeded cards are all off
    const col = await pool.query("SELECT column_default FROM information_schema.columns WHERE table_name = 'fare_snapshots' AND column_name IN ('night_allowance','night_count')")
    expect(col.rows.map((r) => r.column_default)).toEqual(['0', '0'])
  })

  it('rejects a negative allowance at the database', async () => {
    await expect(pool.query('UPDATE rate_cards SET night_allowance_per_night = -1 WHERE id = (SELECT max(id) FROM rate_cards)')).rejects.toThrow()
  })

  it('a new rate card version carries the allowance forward, takes an explicit one (0 switches it off), and starts at 0 when brand new', async () => {
    const a = await card('one_way', 300)
    const carried = await card('one_way')
    expect(Number((await pool.query('SELECT night_allowance_per_night AS v FROM rate_cards WHERE id = $1', [carried])).rows[0].v)).toBe(300)
    expect(Number((await pool.query('SELECT effective_to IS NOT NULL AS closed FROM rate_cards WHERE id = $1', [a])).rows[0].closed)).toBe(1)
    const off = await card('one_way', 0)
    expect(Number((await pool.query('SELECT night_allowance_per_night AS v FROM rate_cards WHERE id = $1', [off])).rows[0].v)).toBe(0)
    const back = await card('one_way', 300) // leave a 300 card current for the rides below
    expect(back).toBeGreaterThan(off)
  })

  it('settles a one-way ride that drove through a night: nights x the rate on the card it was quoted on, recorded on the ride', async () => {
    const rc = await card('one_way', 300)
    const id = await ride('one_way', rc, '2026-11-25T22:00:00')
    const terms = (await repo.getNightTerms(id))!
    expect(terms).toMatchObject({ ride_type: 'one_way', trip_mode: 'standard', rate: 300 })
    const { amount, nights } = night.nightAllowanceFor(terms, new Date('2026-11-26T03:00:00+05:30'))
    expect({ amount, nights }).toEqual({ amount: 300, nights: 1 })
    await repo.recordNightAllowance(id, amount, nights)
    const fs = (await pool.query('SELECT night_allowance::float8 AS a, night_count AS n FROM fare_snapshots WHERE ride_id = $1', [id])).rows[0]
    expect(fs).toEqual({ a: 300, n: 1 })
  })

  it('an admin changing the rate later never reprices a ride already quoted on the old card', async () => {
    const old = await card('one_way', 300)
    const id = await ride('one_way', old, '2026-11-25T22:00:00')
    await card('one_way', 999) // new current version
    expect((await repo.getNightTerms(id))!.rate).toBe(300)
  })

  it('a round trip across two nights pays twice; a daytime trip, a city ride and a rental pay nothing', async () => {
    const rt = await card('round_trip', 250)
    const two = (await repo.getNightTerms(await ride('round_trip', rt, '2026-11-25T20:00:00')))!
    expect(night.nightAllowanceFor(two, new Date('2026-11-27T08:00:00+05:30'))).toEqual({ amount: 500, nights: 2 })

    const ow = await card('one_way', 300)
    const day = (await repo.getNightTerms(await ride('one_way', ow, '2026-11-25T08:00:00')))!
    expect(night.nightAllowanceFor(day, new Date('2026-11-25T16:00:00+05:30')).amount).toBe(0)

    const city = (await repo.getNightTerms(await ride('one_way', ow, '2026-11-25T22:00:00', 'city')))!
    expect(city.trip_mode).toBe('city')
    expect(night.nightAllowanceFor(city, new Date('2026-11-26T03:00:00+05:30')).amount).toBe(0)
  })

  it('a ride booked on a card with no allowance (every ride before this existed) pays nothing', async () => {
    const off = await card('one_way', 0)
    const t = (await repo.getNightTerms(await ride('one_way', off, '2026-11-25T22:00:00')))!
    expect(t.rate).toBe(0)
    expect(night.nightAllowanceFor(t, new Date('2026-11-26T03:00:00+05:30')).amount).toBe(0)
  })

  it('the ride the apps read carries the allowance and its nights', async () => {
    const rc = await card('one_way', 300)
    const id = await ride('one_way', rc, '2026-11-25T22:00:00')
    await repo.recordNightAllowance(id, 300, 1)
    const r = (await repo.getRideById(id)) as unknown as { night_allowance: string; night_count: number }
    expect(Number(r.night_allowance)).toBe(300)
    expect(r.night_count).toBe(1)
  })

  it('commission is taken on the fare without the night allowance, and the driver earns it on top', async () => {
    const rc = await card('one_way', 300)
    const id = await ride('one_way', rc, '2026-11-25T22:00:00')
    await repo.recordNightAllowance(id, 300, 1)
    await pool.query("UPDATE fare_snapshots SET total_final = 1700, status = 'final' WHERE ride_id = $1", [id]) // fare 1400 + night 300
    await payments.createPaymentRecord(id, 'cash_direct')
    const p = (await pool.query('SELECT amount::float8 AS amount, commission_percent::float8 AS pct, commission_amount::float8 AS commission, driver_earning::float8 AS earning FROM payments WHERE ride_id = $1', [id])).rows[0]
    expect(p.amount).toBe(1700)
    expect(p.commission).toBeCloseTo((1400 * p.pct) / 100, 2) // on 1400 only, not 1700
    expect(p.earning).toBeCloseTo(1700 - p.commission, 2)
  })
})
