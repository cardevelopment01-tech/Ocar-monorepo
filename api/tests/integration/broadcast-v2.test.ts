import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { resolveAudience, runBroadcast } from '@/modules/notifications/broadcast.service'
import { loginUser, loginDriver, seedActiveDriverWithVehicle, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'
import { jpegBytes, pngBytes } from '../helpers/images'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// Value: protects=on a real database the audience filters pick exactly the right people (city, vehicle type, document problems, booked
// recently, phone numbers), people who switched the type off or got the daily limit are left out, a broadcast links every notification it
// creates and can be run again without notifying anyone twice, the history counts what happened without exposing typed phone numbers, and only
// ops admins can use any of it; fails_when=a filter or the daily limit is dropped, a repeated run duplicates a notification, a typed phone
// number appears in the history, or a support admin can read or send; why_new=broadcasts were a single unfiltered send with no history;
// seam=none (real Postgres, real routes; the push queue exists but no worker runs, so nothing is sent to Firebase);
// no_claim=Firebase delivery (the worker records its answer, which this test simulates).

// The push provider is replaced so these tests never reach Firebase: a phone whose token contains "dead" is refused, every other is accepted.
const fcm = vi.hoisted(() => ({ calls: [] as Array<{ tokens: string[]; data: Array<Record<string, string>> | undefined; msg: Record<string, unknown> }> }))
vi.mock('@/modules/notifications/providers/push.provider', () => ({
  sendPush: async (tokens: string[], msg: Record<string, unknown>, data?: Array<Record<string, string>>) => {
    fcm.calls.push({ tokens, data, msg })
    const dead = tokens.filter((t) => t.includes('dead'))
    return {
      invalidTokens: dead, successCount: tokens.length - dead.length, failureCount: dead.length, transientFailure: false,
      tokenResults: tokens.map((t) => (t.includes('dead') ? 'invalid' : 'ok')),
    }
  },
}))

// Storage is replaced so the picture route never writes to S3: it records what it was asked to store and can be switched "not configured".
const pics = vi.hoisted(() => ({ configured: true, uploads: [] as unknown[][] }))
vi.mock('@/lib/storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage')>()),
  isPublicImageStorageConfigured: () => pics.configured,
  publicImageBaseUrl: () => 'https://pics.example.com',
  uploadPublicImage: async (...a: unknown[]) => { pics.uploads.push(a); return 'https://pics.example.com/broadcasts/test.jpg' },
}))

const app = createApp()
const P = {
  d1: '+919700007001', d2: '+919700007002', d3: '+919700007003', d4: '+919700007004', d5: '+919700007005',
  r1: '+919700007011', r2: '+919700007012',
  unknown: '+919700007099',
} as const
const OPS = 'bc-ops@test.ocar'
const SUPPORT = 'bc-support@test.ocar'

let opsToken: string
let supportToken: string
let d: Record<'d1' | 'd2' | 'd3' | 'd4' | 'd5', string>
let r: Record<'r1' | 'r2', string>
let suvCategoryId: number
let sedanCategoryId: number
let cuttackId: number
const broadcastIds: string[] = []

const api = (token: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url: string, body: unknown) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body as object),
})
const body = (res: request.Response) => (res.body.data ?? res.body)

beforeAll(async () => {
  suvCategoryId = Number((await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'suv'")).rows[0]!.id)
  sedanCategoryId = Number((await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan'")).rows[0]!.id)
  cuttackId = Number((await pool.query<{ id: string }>("SELECT id FROM cities WHERE slug = 'cuttack'")).rows[0]!.id)

  d = { d1: '', d2: '', d3: '', d4: '', d5: '' }
  const cats: Record<keyof typeof d, string> = { d1: 'sedan', d2: 'suv', d3: 'sedan', d4: 'sedan', d5: 'sedan' }
  for (const k of Object.keys(d) as Array<keyof typeof d>) {
    const { driverId } = await loginDriver(app, redis, P[k])
    d[k] = driverId
    await seedActiveDriverWithVehicle(pool, driverId, { categorySlug: cats[k] })
  }
  // d3 works in Cuttack; d4 is suspended (never a recipient)
  await pool.query('UPDATE drivers SET city_id = $2 WHERE id = $1', [d.d3, cuttackId])
  await pool.query('UPDATE drivers SET city_id = $2 WHERE id = $1', [d.d5, cuttackId]) // d5: a clean slate for the daily-limit test
  await pool.query("UPDATE drivers SET status = 'suspended' WHERE id = $1", [d.d4])
  // d2's insurance expired a week ago: a document keeps them offline
  const vehicle = await pool.query<{ id: string }>('SELECT id FROM driver_vehicles WHERE driver_id = $1 AND is_primary', [d.d2])
  await pool.query(
    `INSERT INTO driver_vehicle_documents (vehicle_id, doc_type, file_url, status, verified_valid_until)
     VALUES ($1, 'insurance', 'https://storage.test/x.jpg', 'approved', CURRENT_DATE - 7)`, [vehicle.rows[0]!.id])
  // d1 has a phone seen today, d3 one last seen 60 days ago (stale), d2 none
  await pool.query(`INSERT INTO device_tokens (owner_type, owner_id, token, platform, last_seen_at) VALUES ('driver', $1, 'tok-bc-d1', 'android', now())`, [d.d1])
  await pool.query(`INSERT INTO device_tokens (owner_type, owner_id, token, platform, last_seen_at) VALUES ('driver', $1, 'tok-bc-d3', 'android', now() - interval '60 days')`, [d.d3])

  const rider1 = await loginUser(app, redis, P.r1)
  const rider2 = await loginUser(app, redis, P.r2)
  r = { r1: rider1.userId, r2: rider2.userId }
  // r1 booked a ride just now; r2 never has
  const booked = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${rider1.accessToken}`).send({ categoryId: sedanCategoryId, ...DEFAULT_BOOKING })
  expect(booked.status, JSON.stringify(booked.body)).toBe(201)

  await seedAdmin(pool, OPS, 'ops_admin')
  await seedAdmin(pool, SUPPORT, 'support_admin')
  opsToken = (await loginAdmin(app, OPS)).accessToken
  supportToken = (await loginAdmin(app, SUPPORT)).accessToken
}, 120_000)

afterAll(async () => {
  const owners = [...Object.values(d), ...Object.values(r)]
  await pool.query('DELETE FROM notification_logs WHERE broadcast_id = ANY($1::bigint[]) OR (owner_id = ANY($2::bigint[]) AND owner_type IN (\'driver\', \'user\'))', [broadcastIds, owners])
  await pool.query('DELETE FROM notification_broadcasts WHERE id = ANY($1::bigint[])', [broadcastIds])
  await pool.query("DELETE FROM notification_preferences WHERE owner_id = ANY($1::bigint[])", [owners])
  await pool.query("DELETE FROM device_tokens WHERE token LIKE 'tok-bc-%'")
  await pool.query('DELETE FROM driver_vehicle_documents WHERE vehicle_id IN (SELECT id FROM driver_vehicles WHERE driver_id = ANY($1::bigint[]))', [Object.values(d)])
  await cleanupRideAndDriverData(pool, Object.values(P))
  await cleanupAdmins(pool, [OPS, SUPPORT])
  await pool.end()
})

describe('who each audience picks (real SQL)', () => {
  const ids = async (a: Parameters<typeof resolveAudience>[0]) => new Set(await resolveAudience(a, 'announcement'))

  it('all drivers: the active ones, never the suspended one', async () => {
    const got = await ids({ role: 'driver' })
    expect([d.d1, d.d2, d.d3].every((x) => got.has(x))).toBe(true)
    expect(got.has(d.d4)).toBe(false)
  })

  it('city', async () => {
    const got = await ids({ role: 'driver', cityIds: [cuttackId] })
    expect(got.has(d.d3)).toBe(true)
    expect(got.has(d.d1)).toBe(false)
    expect(got.has(d.d2)).toBe(false)
  })

  it('vehicle type', async () => {
    const suv = await ids({ role: 'driver', categoryIds: [suvCategoryId] })
    expect(suv.has(d.d2)).toBe(true)
    expect(suv.has(d.d1)).toBe(false)
    const sedan = await ids({ role: 'driver', categoryIds: [sedanCategoryId] })
    expect(sedan.has(d.d1)).toBe(true)
    expect(sedan.has(d.d2)).toBe(false)
  })

  it('blocked by documents: the driver with the expired insurance, not the others', async () => {
    const got = await ids({ role: 'driver', docIssues: true })
    expect(got.has(d.d2)).toBe(true)
    expect(got.has(d.d1)).toBe(false)
    expect(got.has(d.d3)).toBe(false)
  })

  it('filters combine (city AND vehicle type)', async () => {
    expect((await ids({ role: 'driver', cityIds: [cuttackId], categoryIds: [suvCategoryId] })).has(d.d3)).toBe(false)
    expect((await ids({ role: 'driver', cityIds: [cuttackId], categoryIds: [sedanCategoryId] })).has(d.d3)).toBe(true)
  })

  it('riders who booked in the last 30 days: the one who booked, not the one who never did', async () => {
    const got = await ids({ role: 'rider', bookedInLastDays: 30 })
    expect(got.has(r.r1)).toBe(true)
    expect(got.has(r.r2)).toBe(false)
    const everyone = await ids({ role: 'rider' })
    expect(everyone.has(r.r1) && everyone.has(r.r2)).toBe(true)
  })

  it('phone numbers pick exactly those people', async () => {
    const got = await ids({ role: 'driver', phones: [P.d1, P.d3] })
    expect([...got].sort()).toEqual([d.d1, d.d3].sort())
  })
})

describe('the admin routes', () => {
  it('only super and ops admins: a support admin is refused everywhere', async () => {
    const s = api(supportToken)
    expect((await s.get('/api/v1/admin/notifications/broadcasts')).status).toBe(403)
    expect((await s.post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'driver' } })).status).toBe(403)
    expect((await s.post('/api/v1/admin/notifications/broadcast', { title: 'x', body: 'y', category: 'announcement', audience: { role: 'driver' } })).status).toBe(403)
  })

  it('rejects an audience that mixes filters that do not belong together', async () => {
    const ops = api(opsToken)
    expect((await ops.post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'rider', cityIds: [1] } })).status).toBe(422)
    expect((await ops.post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'driver', phones: [P.d1], docIssues: true } })).status).toBe(422)
    expect((await ops.post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'driver', phones: ['123'] } })).status).toBe(422)
  })

  it('the preview breaks a phone-number audience down: who gets the push, who only the in-app, and who was not found', async () => {
    const res = await api(opsToken).post('/api/v1/admin/notifications/preview', {
      category: 'announcement', audience: { role: 'driver', phones: [P.d1, P.d3, P.unknown] },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(body(res)).toMatchObject({
      matched: 2, recipientCount: 2, withDevice: 1, inAppOnly: 1, // d1 has a recent phone, d3's was last seen 60 days ago
      skippedOptedOut: 0, skippedCapped: 0, dailyCap: 2, phonesNotFound: [P.unknown],
    })
  })
})

describe('sending, repeating, limits and history', () => {
  const send = async (audience: object, title = 'Hello') => {
    const res = await api(opsToken).post('/api/v1/admin/notifications/broadcast', { title, body: 'Body text', category: 'announcement', audience })
    if (res.status === 202) broadcastIds.push(String(body(res).id))
    return res
  }
  let first: string

  it('a send to phone numbers is queued, and running it notifies exactly them, linked to the broadcast', async () => {
    const res = await send({ role: 'driver', phones: [P.d1, P.d3] }, 'First')
    expect(res.status, JSON.stringify(res.body)).toBe(202)
    first = String(body(res).id)
    expect(body(res)).toMatchObject({ recipientCount: 2, withDevice: 1 })

    expect(await runBroadcast(first)).toBe(2)
    const rows = await pool.query<{ owner_id: string; type: string }>('SELECT owner_id::text, type FROM notification_logs WHERE broadcast_id = $1 ORDER BY owner_id', [first])
    expect(rows.rows.map((x) => x.owner_id).sort()).toEqual([d.d1, d.d3].sort())
    expect(rows.rows.every((x) => x.type === 'announcement')).toBe(true)
    const b = await pool.query('SELECT status, sent_count, failed_count, recipient_count, finished_at IS NOT NULL AS finished FROM notification_broadcasts WHERE id = $1', [first])
    expect(b.rows[0]).toMatchObject({ status: 'done', sent_count: 2, failed_count: 0, recipient_count: 2, finished: true })
  })

  it('running it again changes nothing, and a run resumed after a crash only notifies whoever is missing', async () => {
    expect(await runBroadcast(first)).toBe(0) // already done
    // Pretend the worker died after notifying d1 only.
    await pool.query("DELETE FROM notification_logs WHERE broadcast_id = $1 AND owner_id = $2", [first, d.d3])
    await pool.query("UPDATE notification_broadcasts SET status = 'sending', finished_at = NULL WHERE id = $1", [first])
    expect(await runBroadcast(first)).toBe(2)
    const rows = await pool.query('SELECT owner_id FROM notification_logs WHERE broadcast_id = $1', [first])
    expect(rows.rowCount).toBe(2) // d1 was not notified a second time
  })

  it('the database itself refuses a second notification for the same person and broadcast', async () => {
    await expect(pool.query(
      `INSERT INTO notification_logs (owner_type, owner_id, channel, status, type, title, body, broadcast_id)
       VALUES ('driver', $1, 'in_app', 'sent', 'announcement', 'x', 'y', $2)`, [d.d1, first])).rejects.toMatchObject({ code: '23505' })
  })

  it('sends aimed at phone numbers never count toward the daily limit; offers to everyone-style audiences do; announcements are never limited', async () => {
    // d1 already has 1 test send today; two more to the same phone are allowed (a test must always go through)...
    expect((await send({ role: 'driver', phones: [P.d1] }, 'Second')).status).toBe(202)
    expect((await send({ role: 'driver', phones: [P.d1] }, 'Third')).status).toBe(202)
    for (const id of broadcastIds.slice(-2)) await runBroadcast(id)
    // ...and they do not use up d1's limit for a real broadcast: three tests later, d1 is still in a normal audience.
    expect((await resolveAudience({ role: 'driver', categoryIds: [sedanCategoryId] }, 'offer')).includes(d.d1)).toBe(true)
    // Two real offers (no typed numbers) reach d1 in the last 24 hours, so a normal audience now skips them.
    const admin = (await pool.query<{ id: string }>('SELECT id::text FROM admins WHERE email = $1', [OPS])).rows[0]!.id
    for (const n of [1, 2]) {
      const id = (await pool.query<{ id: string }>(
        `INSERT INTO notification_broadcasts (admin_id, title, body, category, audience, recipient_count, status)
         VALUES ($1, $2, 'Body text', 'offer', '{"role":"driver"}'::jsonb, 1, 'done') RETURNING id::text`, [admin, `Real ${n}`])).rows[0]!.id
      broadcastIds.push(id)
      await pool.query(
        `INSERT INTO notification_logs (owner_type, owner_id, channel, status, type, title, body, broadcast_id)
         VALUES ('driver', $1, 'in_app', 'sent', 'offer', $2, 'Body text', $3)`, [d.d1, `Real ${n}`, id])
    }
    expect((await resolveAudience({ role: 'driver', categoryIds: [sedanCategoryId] }, 'offer')).includes(d.d1)).toBe(false)
    // ...but an urgent announcement still reaches them: the limit is for offers only
    expect((await resolveAudience({ role: 'driver', categoryIds: [sedanCategoryId] }, 'announcement')).includes(d.d1)).toBe(true)
    const preview = body(await api(opsToken).post('/api/v1/admin/notifications/preview', { category: 'offer', audience: { role: 'driver' } }))
    expect(preview.skippedCapped).toBeGreaterThanOrEqual(1)
    const announcementPreview = body(await api(opsToken).post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'driver' } }))
    expect(announcementPreview.skippedCapped).toBe(0)
    // d3 only ever got test sends, so they are still in
    expect((await resolveAudience({ role: 'driver', cityIds: [cuttackId] }, 'offer')).includes(d.d3)).toBe(true)
  })

  it('someone who switched announcements off is left out, and a send to only them is refused with a clear reason', async () => {
    await pool.query(`INSERT INTO notification_preferences (owner_type, owner_id, category, push_enabled) VALUES ('driver', $1, 'announcements', false)`, [d.d3])
    expect((await resolveAudience({ role: 'driver', cityIds: [cuttackId] }, 'announcement')).includes(d.d3)).toBe(false)
    const res = await send({ role: 'driver', phones: [P.d3] })
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/switched this type off/)
    await pool.query("DELETE FROM notification_preferences WHERE owner_id = $1", [d.d3])
  })

  it('the history lists newest first with what happened to each broadcast, and never shows typed phone numbers', async () => {
    // Firebase's answers, as the push worker records them: d1 accepted, d3's phone was refused.
    await pool.query(`UPDATE notification_logs SET provider_response = '{"successCount":1,"failureCount":0,"invalidTokens":0}', read_at = now() WHERE broadcast_id = $1 AND owner_id = $2`, [first, d.d1])
    await pool.query(`UPDATE notification_logs SET provider_response = '{"successCount":0,"failureCount":1,"invalidTokens":1}' WHERE broadcast_id = $1 AND owner_id = $2`, [first, d.d3])

    const res = await api(opsToken).get('/api/v1/admin/notifications/broadcasts?limit=10')
    expect(res.status).toBe(200)
    const out = body(res) as { broadcasts: Array<Record<string, unknown>>; nextBefore: string | null }
    const ours = out.broadcasts.filter((b) => broadcastIds.includes(String(b['id'])))
    expect(ours.map((b) => b['id'])).toEqual([...broadcastIds].sort((a, b) => Number(b) - Number(a))) // newest first
    const f = ours.find((b) => b['id'] === first)!
    expect(f).toMatchObject({ status: 'done', sent: 2, pushed: 1, pushFailed: 1, noPush: 0, opened: 1, failed: 0, sentBy: OPS, settling: true })
    expect(f['audience']).toEqual({ role: 'driver', phoneCount: 2 })
    expect(JSON.stringify(res.body)).not.toContain('97000070')
  })

  it('pages with before/limit', async () => {
    const page1 = body(await api(opsToken).get('/api/v1/admin/notifications/broadcasts?limit=1')) as { broadcasts: Array<{ id: string }>; nextBefore: string | null }
    expect(page1.broadcasts).toHaveLength(1)
    expect(page1.nextBefore).toBe(page1.broadcasts[0]!.id)
    const page2 = body(await api(opsToken).get(`/api/v1/admin/notifications/broadcasts?limit=1&before=${page1.nextBefore}`)) as { broadcasts: Array<{ id: string }> }
    expect(Number(page2.broadcasts[0]!.id)).toBeLessThan(Number(page1.broadcasts[0]!.id))
    expect((await api(opsToken).get('/api/v1/admin/notifications/broadcasts?limit=0')).status).toBe(422)
    expect((await api(opsToken).get('/api/v1/admin/notifications/broadcasts?before=abc')).status).toBe(422)
  })
})

describe('rollback, a stale daily-limit check, and knowing who a typed number is', () => {
  const sendTo = async (audience: object, title: string, category: 'announcement' | 'offer' = 'announcement') => {
    const res = await api(opsToken).post('/api/v1/admin/notifications/broadcast', { title, body: 'Body text', category, audience })
    if (res.status === 202) broadcastIds.push(String(body(res).id))
    return res
  }
  const history = async () => (body(await api(opsToken).get('/api/v1/admin/notifications/broadcasts?limit=50')) as { broadcasts: Array<Record<string, unknown>> }).broadcasts

  it('a broadcast written by the previous release (no status, nothing tracked) is shown as sent before tracking, never stuck as queued', async () => {
    // The previous release inserts exactly these columns and then notifies people without any broadcast_id.
    const admin = await pool.query<{ id: string }>('SELECT id::text FROM admins WHERE email = $1', [OPS])
    const inserted = await pool.query<{ id: string; status: string; finished_at: string | null }>(
      `INSERT INTO notification_broadcasts (admin_id, title, body, category, audience, recipient_count)
       VALUES ($1, 'Old release', 'Sent by the previous release', 'announcement', '{"role":"driver"}', 42) RETURNING id::text, status, finished_at`, [admin.rows[0]!.id])
    broadcastIds.push(inserted.rows[0]!.id)
    expect(inserted.rows[0]).toMatchObject({ status: 'done', finished_at: null }) // the default is 'done': nothing will ever update this row

    const row = (await history()).find((b) => b['id'] === inserted.rows[0]!.id)!
    expect(row).toMatchObject({ status: 'done', tracked: false, sent: 42, pushed: 0, pushFailed: 0, noPush: 0, opened: 0, settling: false, finishedAt: null })
  })

  it('three offers created back to back: every check says the person will be notified, and the third reports who it had to drop', async () => {
    // Offers are only allowed 10:00-21:00 IST: the clock (Date only) is set to noon IST for this test.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T06:30:00Z'))
    const audience = { role: 'driver', cityIds: [cuttackId], categoryIds: [sedanCategoryId] }
    const ids: string[] = []
    for (const t of ['A', 'B', 'C']) {
      const res = await sendTo(audience, `Back to back ${t}`, 'offer')
      expect(res.status, JSON.stringify(res.body)).toBe(202)
      expect(body(res).recipientCount).toBeGreaterThanOrEqual(2) // d3 and d5 both count in all three checks: nothing has been sent yet
      ids.push(String(body(res).id))
    }
    for (const id of ids) await runBroadcast(id)
    vi.useRealTimers()

    const notified = async (id: string) => (await pool.query<{ owner_id: string }>('SELECT owner_id::text FROM notification_logs WHERE broadcast_id = $1', [id])).rows.map((r) => r.owner_id)
    expect(await notified(ids[0]!)).toContain(d.d5)
    expect(await notified(ids[1]!)).toContain(d.d5)
    expect(await notified(ids[2]!)).not.toContain(d.d5) // d5 already got two broadcasts today: left out when C ran

    const rows = await history()
    const c = rows.find((b) => b['id'] === ids[2])!
    expect(c['skippedAtSend'] as number).toBeGreaterThanOrEqual(1)
    expect(c['sent'] as number).toBeLessThan(0 + (await pool.query<{ n: number }>('SELECT recipient_count AS n FROM notification_broadcasts WHERE id = $1', [ids[2]])).rows[0]!.n)
    expect(c['tracked']).toBe(true)
  })

  it('the check for typed phone numbers names the person each number belongs to, so a wrong number is caught before sending', async () => {
    await pool.query("UPDATE drivers SET full_name = 'Test Driver One' WHERE id = $1", [d.d1])
    await pool.query("UPDATE users SET name = 'Test Rider One' WHERE id = $1", [r.r1])
    const drivers = body(await api(opsToken).post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'driver', phones: [P.d1, P.unknown] } }))
    expect(drivers.people).toEqual([{ phone: P.d1, name: 'Test Driver One', code: expect.stringMatching(/^DRV\d+$/) }])
    expect(drivers.phonesNotFound).toEqual([P.unknown])
    const riders = body(await api(opsToken).post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'rider', phones: [P.r1] } }))
    expect(riders.people).toEqual([{ phone: P.r1, name: 'Test Rider One', code: null }])
    const everyone = body(await api(opsToken).post('/api/v1/admin/notifications/preview', { category: 'announcement', audience: { role: 'driver' } }))
    expect(everyone.people).toEqual([]) // only typed numbers are looked up
  })
})

describe('sending in groups (real database, push provider replaced)', () => {
  const sendTo = async (phones: string[], title: string) => {
    const res = await api(opsToken).post('/api/v1/admin/notifications/broadcast', { title, body: 'Body text', category: 'announcement', audience: { role: 'driver', phones } })
    expect(res.status, JSON.stringify(res.body)).toBe(202)
    broadcastIds.push(String(body(res).id))
    return String(body(res).id)
  }
  const logRow = async (broadcastId: string, owner: string) =>
    (await pool.query<{ id: string; provider: string | null; provider_response: Record<string, number> | null; failure_reason: string | null }>(
      'SELECT id::text, provider, provider_response, failure_reason FROM notification_logs WHERE broadcast_id = $1 AND owner_id = $2', [broadcastId, owner])).rows

  it('records each person\'s push result, removes a dead phone, and gives each phone its own notification id', async () => {
    await pool.query(`INSERT INTO device_tokens (owner_type, owner_id, token, platform, last_seen_at) VALUES
      ('driver', $1, 'tok-bc-d5-live', 'android', now()), ('driver', $1, 'tok-bc-d5-dead', 'android', now())`, [d.d5])
    fcm.calls.length = 0
    const id = await sendTo([P.d5], 'Groups one')
    expect(await runBroadcast(id)).toBe(1)

    const [row] = await logRow(id, d.d5)
    expect(row).toMatchObject({ provider: 'fcm', provider_response: { successCount: 1, failureCount: 1, invalidTokens: 1 }, failure_reason: null })
    const left = (await pool.query<{ token: string }>("SELECT token FROM device_tokens WHERE owner_id = $1 AND token LIKE 'tok-bc-d5%'", [d.d5])).rows.map((x) => x.token)
    expect(left).toEqual(['tok-bc-d5-live']) // the dead phone is gone, the live one stays

    expect(fcm.calls).toHaveLength(1) // one call for the group
    expect(fcm.calls[0]!.tokens.sort()).toEqual(['tok-bc-d5-dead', 'tok-bc-d5-live'])
    expect(fcm.calls[0]!.data!.every((x) => x['notificationId'] === row!.id && x['type'] === 'announcement')).toBe(true)
  })

  it('a person with no phone still gets the in-app row, recorded as nothing pushed, with no Firebase call for them', async () => {
    fcm.calls.length = 0
    const id = await sendTo([P.d2], 'Groups two')
    await runBroadcast(id)
    const [row] = await logRow(id, d.d2)
    expect(row).toMatchObject({ provider: null, provider_response: { successCount: 0, failureCount: 0, invalidTokens: 0 } })
    expect(fcm.calls).toHaveLength(0)
    // and the history counts them as "in-app only", not as failed or pushed
    const hist = (body(await api(opsToken).get('/api/v1/admin/notifications/broadcasts?limit=50')) as { broadcasts: Array<Record<string, unknown>> }).broadcasts
    expect(hist.find((b) => b['id'] === id)).toMatchObject({ sent: 1, pushed: 0, pushFailed: 0, noPush: 1, tracked: true })
  })

  it('a run that stopped after writing a row but before pushing is finished by the next run: pushed once, no second row', async () => {
    fcm.calls.length = 0
    const id = await sendTo([P.d1], 'Groups three')
    // The state a crash leaves: the in-app row exists, its push result does not.
    await pool.query(
      `INSERT INTO notification_logs (owner_type, owner_id, channel, status, type, title, body, broadcast_id)
       VALUES ('driver', $1, 'in_app', 'sent', 'announcement', 'Groups three', 'Body text', $2)`, [d.d1, id])
    expect(await runBroadcast(id)).toBe(1)

    const rows = await logRow(id, d.d1)
    expect(rows).toHaveLength(1) // not duplicated
    expect(rows[0]!.provider_response).toMatchObject({ successCount: 1, failureCount: 0 })
    expect(fcm.calls).toHaveLength(1)
    expect(fcm.calls[0]!.tokens).toEqual(['tok-bc-d1'])
    // and running it yet again does nothing
    fcm.calls.length = 0
    expect(await runBroadcast(id)).toBe(0)
    expect(fcm.calls).toHaveLength(0)
  })

  it('a send with more people than one group is split into groups of at most 500 (one statement and one push call each)', async () => {
    const owners = Array.from({ length: 1100 }, (_, i) => 9_000_000 + i)
    await pool.query(`INSERT INTO users (id, phone, name, status) SELECT g, '+9195' || lpad(g::text, 8, '0'), 'bc-group-' || g, 'active' FROM unnest($1::bigint[]) g`, [owners])
    await pool.query(`INSERT INTO device_tokens (owner_type, owner_id, token, platform, last_seen_at) SELECT 'user', g, 'tok-bc-g' || g, 'android', now() FROM unnest($1::bigint[]) g`, [owners])
    try {
      const admin = (await pool.query<{ id: string }>('SELECT id::text FROM admins WHERE email = $1', [OPS])).rows[0]!.id
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO notification_broadcasts (admin_id, title, body, category, audience, recipient_count, status)
         VALUES ($1, 'Big group', 'Body text', 'announcement', '{"role":"rider"}'::jsonb, 1100, 'queued') RETURNING id::text`, [admin])
      const id = inserted.rows[0]!.id
      broadcastIds.push(id)
      fcm.calls.length = 0
      await runBroadcast(id)
      const mine = fcm.calls.filter((c) => c.tokens.some((t) => t.startsWith('tok-bc-g')))
      expect(mine.every((c) => c.tokens.length <= 500)).toBe(true)
      const pushed = mine.reduce((n, c) => n + c.tokens.filter((t) => t.startsWith('tok-bc-g')).length, 0)
      expect(pushed).toBe(1100)
      const rows = await pool.query<{ n: number; recorded: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE provider_response IS NOT NULL)::int AS recorded FROM notification_logs WHERE broadcast_id = $1 AND owner_id = ANY($2::bigint[])`, [id, owners])
      expect(rows.rows[0]).toEqual({ n: 1100, recorded: 1100 })
    } finally {
      await pool.query("DELETE FROM notification_logs WHERE owner_type = 'user' AND owner_id = ANY($1::bigint[])", [owners])
      await pool.query("DELETE FROM device_tokens WHERE token LIKE 'tok-bc-g%'")
      await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [owners])
    }
  }, 120_000)

  it('a picture and a screen: refused for the wrong app, kept with the broadcast, sent with every push, and shown in the history', async () => {
    const send = (extra: Record<string, unknown>) => api(opsToken).post('/api/v1/admin/notifications/broadcast', { title: 'Pic', body: 'Body text', category: 'announcement', audience: { role: 'driver', phones: [P.d1] }, ...extra })
    expect((await send({ link: 'offers' })).status).toBe(422) // drivers have no offers screen
    expect((await send({ imageUrl: 'http://insecure.example.com/a.jpg' })).status).toBe(422)
    // and the admin is told it is the picture that is wrong, not just "invalid"
    const badPic = await send({ imageUrl: 'https://localhost/a.jpg' })
    expect(badPic.status).toBe(422)
    expect(badPic.body.error).toMatch(/Picture: Image must be a public https link/)
    fcm.calls.length = 0
    const res = await send({ imageUrl: 'https://cdn.example.com/a.jpg', link: 'wallet' })
    expect(res.status, JSON.stringify(res.body)).toBe(202)
    const id = String(body(res).id)
    broadcastIds.push(id)
    await runBroadcast(id)
    expect(fcm.calls).toHaveLength(1)
    expect(fcm.calls[0]!.msg).toMatchObject({ imageUrl: 'https://cdn.example.com/a.jpg', data: { link: 'wallet' } })
    const hist = (body(await api(opsToken).get('/api/v1/admin/notifications/broadcasts?limit=50')) as { broadcasts: Array<Record<string, unknown>> }).broadcasts
    expect(hist.find((b) => b['id'] === id)).toMatchObject({ imageUrl: 'https://cdn.example.com/a.jpg', link: 'wallet' })
  })
})

describe('the picture upload route (real route and auth, storage replaced)', () => {
  const URL = '/api/v1/admin/notifications/broadcast-image'
  const upload = (token: string, buf: Buffer, name = 'banner.jpg', field = 'image') =>
    request(app).post(URL).set('Authorization', `Bearer ${token}`).attach(field, buf, name)

  it('an ops admin uploads a 2:1 picture and gets its public link back', async () => {
    pics.configured = true
    pics.uploads.length = 0
    const buf = jpegBytes(1024, 512, 120_000)
    const res = await upload(opsToken, buf)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body).toEqual({ url: 'https://pics.example.com/broadcasts/test.jpg', width: 1024, height: 512, bytes: 120_000 })
    expect(pics.uploads).toHaveLength(1)
    expect(pics.uploads[0]![1]).toBe('image/jpeg')
    expect(pics.uploads[0]![3]).toBe('broadcasts')
  })

  it('a PNG is stored as a PNG whatever its file name says', async () => {
    pics.uploads.length = 0
    const res = await upload(opsToken, pngBytes(1024, 512, 5000), 'photo.jpg')
    expect(res.status).toBe(201)
    expect(pics.uploads[0]!.slice(1, 3)).toEqual(['image/png', 'png'])
  })

  it('only ops and super admins: a support admin and a signed-out caller are refused, and nothing is stored', async () => {
    pics.uploads.length = 0
    expect((await upload(supportToken, jpegBytes(1024, 512))).status).toBe(403)
    expect((await request(app).post(URL).attach('image', jpegBytes(1024, 512), 'a.jpg')).status).toBe(401)
    expect(pics.uploads).toHaveLength(0)
  })

  it('refuses what is not a JPEG or PNG even when it is named like one, and what is the wrong shape', async () => {
    pics.uploads.length = 0
    const text = await upload(opsToken, Buffer.from('<html><script>alert(1)</script></html>'), 'banner.jpg')
    expect(text.status).toBe(422)
    expect(text.body.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect((await upload(opsToken, jpegBytes(1024, 1024))).status).toBe(422) // square
    expect((await upload(opsToken, jpegBytes(300, 150))).status).toBe(422) // too small
    expect(pics.uploads).toHaveLength(0)
  })

  it('refuses a file over 1 MB with a clear message (and not the generic 5 MB one)', async () => {
    const res = await upload(opsToken, jpegBytes(1024, 512, 1_200_000))
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('FILE_TOO_LARGE')
    expect(res.body.error).toMatch(/under 1 MB/)
  })

  it('a request with no file, or the file under another field name, is a 422 and stores nothing', async () => {
    pics.uploads.length = 0
    expect((await request(app).post(URL).set('Authorization', `Bearer ${opsToken}`)).status).toBe(422)
    expect((await upload(opsToken, jpegBytes(1024, 512), 'a.jpg', 'file')).status).toBe(422)
    expect(pics.uploads).toHaveLength(0)
  })

  it('on a server with no pictures bucket set up it says so (503) and the admin can still paste a link', async () => {
    pics.configured = false
    try {
      const res = await upload(opsToken, jpegBytes(1024, 512))
      expect(res.status).toBe(503)
      expect(res.body.code).toBe('IMAGE_UPLOAD_NOT_CONFIGURED')
      expect(res.body.error).toMatch(/Paste a link/)
    } finally {
      pics.configured = true
    }
  })
})
