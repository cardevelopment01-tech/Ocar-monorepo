import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'
import { processPurgeEtaShadow } from '@/jobs/processors/eta-shadow-purge.processor'
import { updateLocation } from '@/modules/rides/rides.service'
import { resetShadowMemo } from '@/modules/rides/eta-shadow'
import { loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

// Shadow ETA against a real database and Redis (docs/superpowers/plans/2026-11-10-google-maps-cost.md, phase B): the wiring from accept,
// start, driver pings and a rider's route request; the switch; the report query; and the purge.

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// A Google-looking route between any two points: a straight line, its length and a made-up duration. No network.
const helpers = vi.hoisted(() => {
  const enc = (v: number): string => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = ''
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5 }
    return s + String.fromCharCode(n + 63)
  }
  const encode = (pts: Array<[number, number]>): string => {
    let pa = 0, pb = 0, out = ''
    for (const [la, ln] of pts) { const a = Math.round(la * 1e5), b = Math.round(ln * 1e5); out += enc(a - pa) + enc(b - pb); pa = a; pb = b }
    return out
  }
  const km = (a: number, b: number, c: number, d: number): number => {
    const r = (x: number) => (x * Math.PI) / 180
    const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2
    return 2 * 6371 * Math.asin(Math.sqrt(h))
  }
  return {
    route: (oLat: number, oLng: number, dLat: number, dLng: number) => {
      const distanceKm = Math.round(km(oLat, oLng, dLat, dLng) * 10) / 10
      const sec = Math.max(60, Math.round((distanceKm / 40) * 3600))
      return { distanceKm, durationMin: Math.round(sec / 60), trafficDurationMin: Math.round(sec / 60), durationSec: sec, trafficDurationSec: sec,
               polyline: encode([[oLat, oLng], [(oLat + dLat) / 2, (oLng + dLng) / 2], [dLat, dLng]]), source: 'google' as const }
    },
  }
})
vi.mock('@/modules/geo/geo.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/geo/geo.service')>()),
  getRoute: vi.fn(async (a: number, b: number, c: number, d: number) => helpers.route(a, b, c, d)),
}))

const app = createApp()
const PHONES = { driver: '+919800000061', rider: '+919800000062' } as const
const FLAG = 'eta_shadow_enabled'
const NO_RESEND = 'dispatch_no_resend_enabled'

let driver: Awaited<ReturnType<typeof setupOnlineDriver>>
let userToken: string
let rideId: string
const saved = new Map<string, string>()

async function setFlag(key: string, value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [key, value])
  await redis.del(configKey(key))
  resetShadowMemo()
}
const legKey = () => `ride:eta_shadow_leg:${rideId}`
const rows = async (kind?: string) =>
  (await pool.query(`SELECT * FROM ride_eta_shadow WHERE ride_id = $1 ${kind ? `AND kind = '${kind}'` : ''} ORDER BY id`, [rideId])).rows
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 50))
  }
}

beforeAll(async () => {
  driver = await setupOnlineDriver(app, pool, redis, PHONES.driver, { categorySlug: 'sedan' })
  userToken = (await loginUser(app, redis, PHONES.rider)).accessToken
  for (const k of [FLAG, NO_RESEND]) saved.set(k, (await pool.query(`SELECT value FROM system_config WHERE key = $1`, [k])).rows[0]?.value ?? 'false')
  await setFlag(NO_RESEND, 'false')
  await setFlag(FLAG, 'true')
  // The driver waits about 2 km south of the pickup, so the pickup leg has a length.
  await pool.query(`UPDATE driver_location_snapshots SET location = ST_SetSRID(ST_MakePoint(85.82, 20.27), 4326)::geography WHERE driver_id = $1`, [driver.driverId])
})

afterAll(async () => {
  for (const [k, v] of saved) await setFlag(k, v)
  if (rideId) await redis.del(legKey())
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  for (const p of Object.values(PHONES)) {
    for (const k of [`otp_rate:user:${p}:login`, `otp_rate:driver:${p}:login`, `otp:user:${p}:login`, `otp:driver:${p}:login`]) await redis.del(k)
  }
  await pool.end()
  redis.disconnect()
})

describe('the wiring, with the switch on', () => {
  it('accepting a ride keeps the pickup leg\'s route in Redis, from the route the ETA snapshot already fetched', async () => {
    const book = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${userToken}`).send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
    expect(book.status, JSON.stringify(book.body)).toBe(201)
    rideId = book.body.rideId as string
    await processBroadcast({ rideId, categoryId: String(driver.categoryId), originLat: DEFAULT_BOOKING.originLat, originLng: DEFAULT_BOOKING.originLng, rideType: DEFAULT_BOOKING.rideType, isReturnCab: false, broadcastRound: 1 })
    const accept = await request(app).post(`/api/v1/rides/${rideId}/accept`).set('Authorization', `Bearer ${driver.accessToken}`)
    expect(accept.status, JSON.stringify(accept.body)).toBe(200)

    const raw = await waitFor(() => redis.get(legKey()))
    const stored = JSON.parse(raw)
    expect(stored).toMatchObject({ leg: 'to_pickup', destLat: DEFAULT_BOOKING.originLat, destLng: DEFAULT_BOOKING.originLng })
    expect(stored.baselineSec).toBeGreaterThan(0)
    expect(await redis.ttl(legKey())).toBeGreaterThan(5 * 3600)
  })

  it('a driver ping on the active ride logs the ETA the stored route and the driver\'s progress give, at most every 30 s', async () => {
    await updateLocation(BigInt(driver.driverId), { sessionId: BigInt(driver.sessionId), lat: 20.275, lng: 85.82, recordedAt: new Date().toISOString() })
    const ours = await waitFor(async () => { const r = await rows('ours'); return r.length ? r : null })
    expect(ours).toHaveLength(1)
    expect(ours[0]).toMatchObject({ leg: 'to_pickup', kind: 'ours' })
    expect(ours[0].remaining_m).toBeGreaterThan(1200)   // 20.275 -> 20.29 is about 1.7 km
    expect(ours[0].remaining_m).toBeLessThan(2200)
    expect(ours[0].off_route_m).toBeLessThan(50)
    expect(ours[0].eta_sec).toBeGreaterThan(0)
    await updateLocation(BigInt(driver.driverId), { sessionId: BigInt(driver.sessionId), lat: 20.2755, lng: 85.82, recordedAt: new Date().toISOString() })
    await new Promise((r) => setTimeout(r, 200))
    expect(await rows('ours')).toHaveLength(1) // throttled
  })

  it('the rider\'s traffic-aware route request for that leg is noted with what Google showed, and the answer is unchanged', async () => {
    const res = await request(app).get('/api/v1/geo/route')
      .query({ originLat: 20.28, originLng: 85.82, destLat: DEFAULT_BOOKING.originLat, destLng: DEFAULT_BOOKING.originLng, trafficAware: 'true' })
      .set('Authorization', `Bearer ${userToken}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ source: 'google' })
    const g = await waitFor(async () => { const r = await rows('google'); return r.length ? r : null })
    expect(g[0]).toMatchObject({ leg: 'to_pickup', kind: 'google' })
    expect(g[0].eta_sec).toBe(res.body.trafficDurationSec)
  })

  it('a route request that is not traffic-aware, or for another destination, is not noted', async () => {
    resetShadowMemo() // forget the 20 s per-ride sampling gap, so only the rules under test can keep a request out
    await request(app).get('/api/v1/geo/route').query({ originLat: 20.28, originLng: 85.82, destLat: DEFAULT_BOOKING.originLat, destLng: DEFAULT_BOOKING.originLng })
      .set('Authorization', `Bearer ${userToken}`)
    await request(app).get('/api/v1/geo/route').query({ originLat: 20.28, originLng: 85.82, destLat: 20.5, destLng: 85.9, trafficAware: 'true' })
      .set('Authorization', `Bearer ${userToken}`)
    await new Promise((r) => setTimeout(r, 300))
    expect(await rows('google')).toHaveLength(1)
  })

  it('starting the trip replaces the leg with the trip leg', async () => {
    const arrived = await request(app).post(`/api/v1/rides/${rideId}/arrived`).set('Authorization', `Bearer ${driver.accessToken}`)
    expect(arrived.status, JSON.stringify(arrived.body)).toBe(200)
    const ride = await request(app).get(`/api/v1/rides/${rideId}`).set('Authorization', `Bearer ${userToken}`)
    const start = await request(app).post(`/api/v1/rides/${rideId}/start-otp`).set('Authorization', `Bearer ${driver.accessToken}`).send({ otp: ride.body.startOtp })
    expect(start.status, JSON.stringify(start.body)).toBe(200)
    const stored = await waitFor(async () => { const s = JSON.parse((await redis.get(legKey())) ?? '{}'); return s.leg === 'to_destination' ? s : null })
    expect(stored).toMatchObject({ destLat: DEFAULT_BOOKING.destinationLat, destLng: DEFAULT_BOOKING.destinationLng })
  })
})

describe('with the switch off', () => {
  it('nothing new is stored or logged', async () => {
    await setFlag(FLAG, 'false')
    await redis.del(legKey())
    const before = (await rows()).length
    await updateLocation(BigInt(driver.driverId), { sessionId: BigInt(driver.sessionId), lat: 20.3, lng: 85.83, recordedAt: new Date().toISOString() })
    await new Promise((r) => setTimeout(r, 300))
    expect(await rows()).toHaveLength(before)
    expect(await redis.get(legKey())).toBeNull()
  })
})

describe('the report', () => {
  const statements = readFileSync(resolve(__dirname, '../../scripts/eta-shadow-report.sql'), 'utf8')
    .split(/\n;\s*\n|\n;\s*$/).map((s) => s.trim()).filter((s) => /\bSELECT\b|\bWITH\b/i.test(s.replace(/^(\s*--.*\n)+/, '')))

  it('is read-only and has the three statements', () => {
    expect(statements).toHaveLength(3)
    for (const s of statements) expect(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(s.replace(/--.*$/gm, ''))).toBe(false)
  })

  it('measures each estimate against the real arrival time, by minutes-to-go bucket', async () => {
    await pool.query(`DELETE FROM ride_eta_shadow WHERE ride_id = $1`, [rideId])
    // Pickup leg: accepted 30 min ago, arrived 10 min ago. Samples at known distances from the arrival.
    const c = await pool.connect()
    try {
      await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`)
      await c.query(`UPDATE rides SET accepted_at = now() - interval '30 minutes', driver_arrived_at = now() - interval '10 minutes' WHERE id = $1`, [rideId])
      await c.query('COMMIT')
    } finally { c.release() }
    const ins = (kind: string, minsBeforeArrival: number, eta: number, base: number | null, off: number | null) => pool.query(
      `INSERT INTO ride_eta_shadow (ride_id, leg, kind, at, eta_sec, eta_base_sec, remaining_m, off_route_m)
       VALUES ($1, 'to_pickup', $2, now() - interval '10 minutes' - ($3 || ' minutes')::interval, $4, $5, 1000, $6)`,
      [rideId, kind, minsBeforeArrival, eta, base, off])
    await ins('ours', 10, 540, 570, 20)      // true 600 s left: blend 60 s short, base 30 s short
    await ins('ours', 5, 330, 310, 30)       // true 300 s left: blend 30 s long, base 10 s long
    await ins('ours', 5, 9999, 9999, 400)    // off route: left out of the ours rows
    await ins('google', 5, 420, null, null)  // true 300 s left: 120 s long
    await ins('google', 10, 660, null, null) // true 600 s left: 60 s long

    const r1 = await pool.query(statements[0]!)
    const at = (estimate: string, bucket: string) => r1.rows.find((r) => r.estimate === estimate && r.bucket === bucket && r.leg === 'to_pickup')
    expect(Number(at('ours_blend', '10 min').mean_abs_error_min)).toBeCloseTo(1.0, 1)
    expect(Number(at('ours_blend', '10 min').bias_min)).toBeCloseTo(-1.0, 1)
    expect(Number(at('ours_base', '10 min').mean_abs_error_min)).toBeCloseTo(0.5, 1)
    expect(Number(at('ours_blend', '5 min').mean_abs_error_min)).toBeCloseTo(0.5, 1)   // the off-route sample is not in it
    expect(at('ours_blend', '5 min').samples).toBe('1')
    expect(Number(at('google', '5 min').mean_abs_error_min)).toBeCloseTo(2.0, 1)
    expect(Number(at('google', '10 min').bias_min)).toBeCloseTo(1.0, 1)

    const r2 = await pool.query(statements[1]!)
    expect(r2.rows.find((r) => r.leg === 'to_pickup' && r.kind === 'ours')).toMatchObject({ samples: '3', rides: '1' })
    const r3 = await pool.query(statements[2]!)
    expect(r3.rows.find((r) => r.leg === 'to_pickup')).toMatchObject({ ours_samples: '3', off_route_samples: '1' })
  })

  it('leaves out rides with stops', async () => {
    const stopsTable = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ride_stops' AND column_name = 'ride_id'`)
    expect(stopsTable.rowCount).toBe(1) // the report's stops filter relies on this column
  })
})

describe('the purge', () => {
  it('deletes samples older than 90 days and keeps newer ones', async () => {
    await pool.query(`DELETE FROM ride_eta_shadow WHERE ride_id = $1`, [rideId])
    await pool.query(
      `INSERT INTO ride_eta_shadow (ride_id, leg, kind, at, eta_sec) VALUES
         ($1, 'to_pickup', 'ours', now() - interval '100 days', 60), ($1, 'to_pickup', 'ours', now() - interval '91 days', 60), ($1, 'to_pickup', 'ours', now() - interval '89 days', 60)`, [rideId])
    expect(await processPurgeEtaShadow()).toBeGreaterThanOrEqual(2)
    expect((await rows()).length).toBe(1)
  })

  it('samples go with their ride', async () => {
    expect((await pool.query(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'ride_eta_shadow'::regclass AND contype = 'f'`)).rows[0].confdeltype).toBe('c')
  })
})
