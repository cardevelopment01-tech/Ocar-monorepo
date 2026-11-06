import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'
import { deleteAccount } from '@/modules/account/account.service'
import { purgeOld } from '@/modules/ride-shares/ride-shares.repository'
import { configKey } from '@/constants/redis-keys'
import { loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// Value: protects=the whole share lifecycle against the real database: create -> public page -> revoke -> 404, the public
// response carries nothing private, caps hold, account deletion removes the links and the purge keeps recent ones;
// fails_when=any SQL, ownership rule or the allow-list breaks; why_new=new feature; seam=real Postgres + Redis, SMS not involved
// (anonymous links only); no_claim=real phones, Google routing (not configured in test) or the SMS vendor.
const app = createApp()
const PHONES = { rider: '+919700000081', driver: '+919700000082', other: '+919700000083', deleted: '+919700000084', deletedDriver: '+919700000085', purgeRider: '+919700000086', purgeDriver: '+919700000087' } as const
const ALL = Object.values(PHONES)

async function bookAndAccept(userToken: string, driver: { categoryId: number; accessToken: string }) {
  const bookRes = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${userToken}`).send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
  expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
  const rideId = bookRes.body.rideId as string
  await processBroadcast({ rideId, categoryId: String(driver.categoryId), originLat: DEFAULT_BOOKING.originLat, originLng: DEFAULT_BOOKING.originLng, rideType: DEFAULT_BOOKING.rideType, isReturnCab: false, broadcastRound: 1 })
  const acc = await request(app).post(`/api/v1/rides/${rideId}/accept`).set('Authorization', `Bearer ${driver.accessToken}`)
  expect(acc.status, JSON.stringify(acc.body)).toBe(200)
  return rideId
}
const tokenOf = (url: string) => url.split('/t/')[1]!

beforeAll(async () => {
  await pool.query(`INSERT INTO system_config (key, value, value_type, is_public, description) VALUES ('trip_share_enabled', 'true', 'boolean', false, 'test') ON CONFLICT (key) DO UPDATE SET value = 'true'`)
  await redis.del(configKey('trip_share_enabled')).catch(() => undefined)
})

afterAll(async () => {
  await pool.query(`UPDATE system_config SET value = 'false' WHERE key = 'trip_share_enabled'`)
  await cleanupRideAndDriverData(pool, [...ALL])
  for (const p of ALL) for (const k of [`otp_rate:user:${p}:login`, `otp_rate:driver:${p}:login`, `otp:user:${p}:login`, `otp:driver:${p}:login`]) await redis.del(k)
  await pool.end()
  redis.disconnect()
})

describe('live trip sharing (real database)', () => {
  it('create -> public page (allow-listed, no private data) -> 404 for a wrong token -> revoke -> 404', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.driver, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.rider)
    const rideId = await bookAndAccept(userToken, driver)

    const created = await request(app).post(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`).send({})
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const share = created.body.shares[0] as { id: string; url: string }
    expect(share.url).toMatch(/\/t\/[A-Za-z0-9_-]{22}$/)
    const token = tokenOf(share.url)

    // Only the hash is stored.
    const stored = await pool.query<{ token_hash: string }>('SELECT token_hash FROM ride_shares WHERE id = $1', [share.id])
    expect(stored.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.rows[0]!.token_hash).not.toContain(token)

    // The public page: no auth, allow-listed keys, nothing private.
    const page = await request(app).get(`/api/v1/public/trips/${token}`)
    expect(page.status, JSON.stringify(page.body)).toBe(200)
    expect(page.headers['cache-control']).toBe('no-store')
    expect(page.body.phase).toBe('driver_on_way')
    expect(Object.keys(page.body).sort()).toEqual(
      ['completedAt', 'driver', 'driverFirstName', 'drop', 'etaMin', 'isSos', 'phase', 'pickup', 'riderFirstName', 'route', 'serverTime', 'stops', 'vehicle'].sort(),
    )
    const text = JSON.stringify(page.body)
    for (const secret of [PHONES.rider, PHONES.driver, 'otp', 'fare', 'phone']) expect(text.toLowerCase()).not.toContain(secret.toLowerCase())

    // A wrong (well-formed) token and a malformed one are both 404.
    expect((await request(app).get(`/api/v1/public/trips/${'A'.repeat(22)}`)).status).toBe(404)
    expect((await request(app).get('/api/v1/public/trips/short')).status).toBe(404)

    // The rider sees it in their list; another rider cannot touch it.
    const list = await request(app).get(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`)
    expect(list.status).toBe(200)
    expect(list.body.shares).toHaveLength(1)
    const { accessToken: otherToken } = await loginUser(app, redis, PHONES.other)
    expect((await request(app).get(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${otherToken}`)).status).toBe(404)
    expect((await request(app).delete(`/api/v1/rides/${rideId}/shares/${share.id}`).set('Authorization', `Bearer ${otherToken}`)).status).toBe(404)

    // Revoke: the very next poll is a 404.
    const stop = await request(app).delete(`/api/v1/rides/${rideId}/shares/${share.id}`).set('Authorization', `Bearer ${userToken}`)
    expect(stop.status).toBe(204)
    expect((await request(app).get(`/api/v1/public/trips/${token}`)).status).toBe(404)
  })

  it('caps active links per ride at 10, stop-all frees the cap, and account deletion removes the links', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.deletedDriver, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.deleted)
    const rideId = await bookAndAccept(userToken, driver)

    for (let i = 0; i < 10; i++) {
      const r = await request(app).post(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`).send({})
      expect(r.status, JSON.stringify(r.body)).toBe(201)
    }
    const eleventh = await request(app).post(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`).send({})
    expect(eleventh.status).toBe(429)
    expect(eleventh.body.code).toBe('TRIP_SHARE_LIMIT')

    // Stop all frees the cap.
    expect((await request(app).delete(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`)).status).toBe(204)
    expect((await request(app).post(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`).send({})).status).toBe(201)

    // Account deletion removes the user's links (the users row stays, so a cascade would never fire). The ride must be over first.
    await pool.query(`UPDATE rides SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [rideId])
    const before = await pool.query('SELECT count(*)::int AS n FROM ride_shares WHERE ride_id = $1', [rideId])
    expect(before.rows[0]!.n).toBeGreaterThan(0)
    const uid = (await pool.query<{ id: string }>('SELECT id FROM users WHERE phone = $1', [PHONES.deleted])).rows[0]!.id
    await deleteAccount('user', BigInt(uid), null)
    const after = await pool.query('SELECT count(*)::int AS n FROM ride_shares WHERE user_id = $1', [uid])
    expect(after.rows[0]!.n).toBe(0)
  })

  it('the purge keeps recent links and removes ones whose ride ended more than 30 days ago', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.purgeDriver, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.purgeRider)
    const rideId = await bookAndAccept(userToken, driver)
    const a = await request(app).post(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`).send({})
    const b = await request(app).post(`/api/v1/rides/${rideId}/shares`).set('Authorization', `Bearer ${userToken}`).send({})
    const [idA, idB] = [a.body.shares[0].id, b.body.shares[0].id]
    await pool.query(`UPDATE ride_shares SET created_at = now() - interval '40 days' WHERE id = $1`, [idA])
    await purgeOld()
    const left = await pool.query<{ id: string }>('SELECT id FROM ride_shares WHERE id = ANY($1::bigint[])', [[idA, idB]])
    expect(left.rows.map((r) => r.id)).toEqual([idB])
  })
})
