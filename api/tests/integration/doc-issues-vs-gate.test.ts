import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createApp } from '@/app'
import request from 'supertest'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hasApprovedRequiredDocs, hasAllRequiredDocsApproved, findDocsNeedingExpiryNotice } from '@/modules/drivers/drivers.repository'
import { findDocIssues } from '@/modules/drivers/doc-issues'
import { loginDriver, seedActiveDriverWithVehicle, cleanupRideAndDriverData, completeDailyVerification, goOnline } from '../helpers/fixtures/rides.fixture'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// Value: protects=the list of blocking documents (findDocIssues: what the driver, the admin and the go-online error show) is empty
// exactly when the SQL gate that dispatch and goOnline have always used (hasApprovedRequiredDocs) lets the driver through, for
// every kind of document problem; fails_when=one rule is changed in only one of the two places (for example a new document state
// blocks in SQL but is not listed, so a driver is blocked with nothing to show); why_new=the two are separate pieces of code that
// must agree; seam=none (real database, real SQL); no_claim=the wording of the messages (unit tests).

const app = createApp()
const PHONE = '+919700005001'
const ADMIN_EMAIL = 'doc-issues-admin@test.ocar'
let driverId: string
let vehicleId: string
let driverToken: string
let categoryId: number

type Doc = [docType: string, status: string, validUntil?: string | 'yesterday' | 'today' | 'tomorrow']
const ALL_IDENTITY = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
const GOOD_VEHICLE: Doc[] = [['vehicle_rc_front', 'approved'], ['vehicle_rc_back', 'approved'], ['insurance', 'approved', 'tomorrow'], ['permit', 'approved']]
const good = (): { identity: Doc[]; vehicle: Doc[] } => ({ identity: ALL_IDENTITY.map((t) => [t, 'approved'] as Doc), vehicle: GOOD_VEHICLE.map((d) => [...d] as Doc) })

const OFFSET: Record<string, string> = { yesterday: "CURRENT_DATE - 1", today: 'CURRENT_DATE', tomorrow: 'CURRENT_DATE + 1' }

async function setDocs(identity: Doc[], vehicle: Doc[]) {
  await pool.query('DELETE FROM driver_documents WHERE driver_id = $1', [driverId])
  await pool.query('DELETE FROM driver_vehicle_documents WHERE vehicle_id = $1', [vehicleId])
  for (const [t, status, valid] of identity) {
    await pool.query(
      `INSERT INTO driver_documents (driver_id, doc_type, file_url, status, verified_valid_until)
       VALUES ($1, $2::doc_type, 'https://storage.test/x.jpg', $3::doc_status, ${valid ? OFFSET[valid] : 'NULL'})`,
      [driverId, t, status],
    )
  }
  for (const [t, status, valid] of vehicle) {
    await pool.query(
      `INSERT INTO driver_vehicle_documents (vehicle_id, doc_type, file_url, status, verified_valid_until)
       VALUES ($1, $2, 'https://storage.test/x.jpg', $3::doc_status, ${valid ? OFFSET[valid] : 'NULL'})`,
      [vehicleId, t, status],
    )
  }
}

beforeAll(async () => {
  const { driverId: id, accessToken } = await loginDriver(app, redis, PHONE)
  driverId = id
  driverToken = accessToken
  const seeded = await seedActiveDriverWithVehicle(pool, driverId)
  vehicleId = seeded.vehicleId
  categoryId = seeded.categoryId
})

afterAll(async () => {
  await cleanupAdmins(pool, [ADMIN_EMAIL])
  await cleanupRideAndDriverData(pool, [PHONE])
  await pool.end()
})

describe('findDocIssues agrees with the SQL go-online gate', () => {
  const scenarios: Array<[string, () => { identity: Doc[]; vehicle: Doc[] }]> = [
    ['everything approved and valid', good],
    ['insurance expired yesterday', () => { const g = good(); g.vehicle[2] = ['insurance', 'approved', 'yesterday']; return g }],
    ['insurance valid until today', () => { const g = good(); g.vehicle[2] = ['insurance', 'approved', 'today']; return g }],
    ['optional pollution certificate expired', () => { const g = good(); g.vehicle.push(['pollution_cert', 'approved', 'yesterday']); return g }],
    ['optional pollution certificate still pending', () => { const g = good(); g.vehicle.push(['pollution_cert', 'pending']); return g }],
    ['optional fitness certificate rejected', () => { const g = good(); g.vehicle.push(['fitness_cert', 'rejected']); return g }],
    ['required permit pending review', () => { const g = good(); g.vehicle[3] = ['permit', 'pending']; return g }],
    ['identity document rejected', () => { const g = good(); g.identity[0] = ['profile_photo', 'rejected']; return g }],
    ['identity document expired', () => { const g = good(); g.identity[1] = ['driving_license_front', 'approved', 'yesterday']; return g }],
    ['identity document pending review', () => { const g = good(); g.identity[4] = ['aadhaar_back', 'pending']; return g }],
    ['RC front without RC back', () => { const g = good(); g.vehicle = g.vehicle.filter((d) => d[0] !== 'vehicle_rc_back'); return g }],
    ['no vehicle documents at all', () => { const g = good(); g.vehicle = []; return g }],
    ['no identity documents at all', () => { const g = good(); g.identity = []; return g }],
  ]

  it.each(scenarios)('%s', async (_name, build) => {
    const { identity, vehicle } = build()
    await setDocs(identity, vehicle)
    const gateAllows = await hasApprovedRequiredDocs(BigInt(driverId))
    const issues = await findDocIssues(BigInt(driverId))
    expect(issues.length === 0, `gate allows=${gateAllows}, issues=${JSON.stringify(issues.map((i) => `${i.doc_type}:${i.reason}`))}`).toBe(gateAllows)
  })

  it('names the document and the date for an expired insurance, with the real database date', async () => {
    const g = good(); g.vehicle[2] = ['insurance', 'approved', 'yesterday']
    await setDocs(g.identity, g.vehicle)
    const issues = await findDocIssues(BigInt(driverId))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ scope: 'vehicle', doc_type: 'insurance', reason: 'expired', label: 'Insurance' })
    const { rows } = await pool.query<{ d: string }>('SELECT (CURRENT_DATE - 1)::text AS d')
    expect(issues[0]!.valid_until).toBe(rows[0]!.d)
  })
})

// An electric vehicle needs no commercial permit and has no PUC: neither is required, and neither can block it. Real SQL, so
// the gate (dispatch / go-online), the issue list, the completeness check and the expiry reminders are all checked together.
describe('electric vehicle: permit and PUC do not apply', () => {
  const evBase = (): { identity: Doc[]; vehicle: Doc[] } => {
    const g = good(); g.vehicle = g.vehicle.filter((d) => d[0] !== 'permit'); return g
  }
  const scenarios: Array<[string, () => { identity: Doc[]; vehicle: Doc[] }, blocked: boolean]> = [
    ['no permit uploaded at all', evBase, false],
    ['permit pending review', () => { const g = evBase(); g.vehicle.push(['permit', 'pending']); return g }, false],
    ['permit rejected', () => { const g = evBase(); g.vehicle.push(['permit', 'rejected']); return g }, false],
    ['permit expired', () => { const g = evBase(); g.vehicle.push(['permit', 'approved', 'yesterday']); return g }, false],
    ['PUC expired', () => { const g = evBase(); g.vehicle.push(['pollution_cert', 'approved', 'yesterday']); return g }, false],
    ['PUC rejected', () => { const g = evBase(); g.vehicle.push(['pollution_cert', 'rejected']); return g }, false],
    ['insurance expired still blocks', () => { const g = evBase(); g.vehicle[2] = ['insurance', 'approved', 'yesterday']; return g }, true],
    ['insurance pending still blocks', () => { const g = evBase(); g.vehicle[2] = ['insurance', 'pending']; return g }, true],
    ['RC back missing still blocks', () => { const g = evBase(); g.vehicle = g.vehicle.filter((d) => d[0] !== 'vehicle_rc_back'); return g }, true],
    ['optional fitness certificate expired still blocks (it applies to an EV)', () => { const g = evBase(); g.vehicle.push(['fitness_cert', 'approved', 'yesterday']); return g }, true],
  ]

  beforeAll(async () => { await pool.query(`UPDATE driver_vehicles SET fuel_type = 'electric' WHERE id = $1`, [vehicleId]) })
  afterAll(async () => { await pool.query(`UPDATE driver_vehicles SET fuel_type = 'petrol' WHERE id = $1`, [vehicleId]) })

  it.each(scenarios)('%s', async (_name, build, blocked) => {
    const { identity, vehicle } = build()
    await setDocs(identity, vehicle)
    const gateAllows = await hasApprovedRequiredDocs(BigInt(driverId))
    const issues = await findDocIssues(BigInt(driverId))
    expect(gateAllows, `issues=${JSON.stringify(issues.map((i) => `${i.doc_type}:${i.reason}`))}`).toBe(!blocked)
    expect(issues.length === 0).toBe(!blocked)
  })

  it('a complete EV needs no permit to count as fully approved, but a petrol vehicle with the same documents does not', async () => {
    const g = evBase()
    await setDocs(g.identity, g.vehicle)
    expect(await hasAllRequiredDocsApproved(BigInt(driverId))).toBe(true)
    await pool.query(`UPDATE driver_vehicles SET fuel_type = 'petrol' WHERE id = $1`, [vehicleId])
    expect(await hasAllRequiredDocsApproved(BigInt(driverId))).toBe(false)
    await pool.query(`UPDATE driver_vehicles SET fuel_type = 'electric' WHERE id = $1`, [vehicleId])
  })

  it('an expiring EV permit or PUC gets no reminder, while an expiring insurance does', async () => {
    const g = evBase()
    g.vehicle.push(['permit', 'approved', 'tomorrow'], ['pollution_cert', 'approved', 'tomorrow'])
    g.vehicle[2] = ['insurance', 'approved', 'tomorrow']
    await setDocs(g.identity, g.vehicle)
    const mine = (await findDocsNeedingExpiryNotice()).filter((n) => n.driverId === driverId && n.daysRemaining === 1)
    expect(mine.map((n) => n.docType).sort()).toEqual(['insurance'])
  })

  it("the admin 'Docs to review' queue lists a petrol driver with a pending permit but not an electric one", async () => {
    await seedAdmin(pool, ADMIN_EMAIL)
    const { accessToken } = await loginAdmin(app, ADMIN_EMAIL)
    const g = evBase(); g.vehicle.push(['permit', 'pending'])
    await setDocs(g.identity, g.vehicle)
    const inQueue = async () => {
      const res = await request(app).get('/api/v1/admin/drivers?status=docs_review&limit=100').set('Authorization', `Bearer ${accessToken}`)
      expect(res.status).toBe(200)
      return ((res.body.data ?? res.body.drivers ?? res.body) as Array<{ id: string }>).some((d) => String(d.id) === String(driverId))
    }
    expect(await inQueue()).toBe(false)
    await pool.query(`UPDATE driver_vehicles SET fuel_type = 'petrol' WHERE id = $1`, [vehicleId])
    expect(await inQueue()).toBe(true)
    await pool.query(`UPDATE driver_vehicles SET fuel_type = 'electric' WHERE id = $1`, [vehicleId])
  })
})

describe('the admin driver profile returns the same list', () => {
  it('GET /admin/drivers/:id carries doc_issues, so an admin can see why a driver cannot go online', async () => {
    await seedAdmin(pool, ADMIN_EMAIL)
    const { accessToken } = await loginAdmin(app, ADMIN_EMAIL)
    const g = good(); g.vehicle[2] = ['insurance', 'approved', 'yesterday']; g.vehicle.push(['pollution_cert', 'approved', 'yesterday'])
    await setDocs(g.identity, g.vehicle)

    const res = await request(app).get(`/api/v1/admin/drivers/${driverId}`).set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(200)
    const body = res.body.data ?? res.body
    expect((body.doc_issues as Array<{ doc_type: string; reason: string }>).map((i) => `${i.doc_type}:${i.reason}`)).toEqual(['insurance:expired', 'pollution_cert:expired'])
    // the document rows themselves still say approved: the list is what tells the admin they have expired
    expect((body.vehicle_documents as Array<{ doc_type: string; status: string }>).find((d) => d.doc_type === 'insurance')!.status).toBe('approved')
  })
})

describe('the go-online error reaches the driver with the list', () => {
  it('POST /rides/sessions/online answers 403 DRIVER_DOCS_REJECTED, names the expired documents, and carries details.issues', async () => {
    const g = good(); g.vehicle[2] = ['insurance', 'approved', 'yesterday']; g.vehicle.push(['pollution_cert', 'approved', 'yesterday'])
    await setDocs(g.identity, g.vehicle)
    await completeDailyVerification(app, driverToken)

    const res = await goOnline(app, driverToken, vehicleId, categoryId)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('DRIVER_DOCS_REJECTED')
    expect(res.body.error).toContain("You can't go online yet:")
    expect(res.body.error).toContain('Insurance expired on')
    expect(res.body.error).toContain('Pollution certificate (PUC) expired on')
    expect((res.body.details.issues as Array<{ doc_type: string; reason: string }>).map((i) => `${i.doc_type}:${i.reason}`)).toEqual(['insurance:expired', 'pollution_cert:expired'])
  })

  it('the same driver with valid documents is not refused by the document gate', async () => {
    const g = good()
    await setDocs(g.identity, g.vehicle)
    const res = await goOnline(app, driverToken, vehicleId, categoryId)
    expect(res.body.code).not.toBe('DRIVER_DOCS_REJECTED')
  })
})

describe('the Drivers list "doc issues" tab', () => {
  const list = async (status: string) => {
    const { accessToken } = await loginAdmin(app, ADMIN_EMAIL)
    const res = await request(app).get(`/api/v1/admin/drivers?status=${status}&limit=100`).set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(200)
    const body = res.body.data ?? res.body
    return body as { drivers: Array<{ id: string; status: string; doc_issues: Array<{ doc_type: string; reason: string }> }>; summary: { doc_issues: number } }
  }

  it('an active driver whose insurance and pollution certificate expired is listed, with the reasons, and counted', async () => {
    await seedAdmin(pool, ADMIN_EMAIL)
    const g = good(); g.vehicle[2] = ['insurance', 'approved', 'yesterday']; g.vehicle.push(['pollution_cert', 'approved', 'yesterday'])
    await setDocs(g.identity, g.vehicle)

    const out = await list('doc_issues')
    const row = out.drivers.find((d) => d.id === driverId)
    expect(row, 'the blocked driver is on the tab').toBeDefined()
    expect(row!.status).toBe('active') // the status alone says nothing is wrong: this is what the tab is for
    expect(row!.doc_issues.map((i) => `${i.doc_type}:${i.reason}`)).toEqual(['insurance:expired', 'pollution_cert:expired'])
    expect(out.summary.doc_issues).toBeGreaterThanOrEqual(1)
  })

  it('every driver on the tab has a reason; the same driver with valid documents is not on it', async () => {
    const g = good()
    await setDocs(g.identity, g.vehicle)
    const out = await list('doc_issues')
    expect(out.drivers.find((d) => d.id === driverId)).toBeUndefined()
    for (const d of out.drivers) expect(d.doc_issues.length, `driver ${d.id} is on the tab but no reason was found`).toBeGreaterThan(0)
  })

  it('the ordinary list marks the same driver with the reasons, so an "active" driver is not shown as fine', async () => {
    const g = good(); g.vehicle[2] = ['insurance', 'approved', 'yesterday']
    await setDocs(g.identity, g.vehicle)
    const { accessToken } = await loginAdmin(app, ADMIN_EMAIL)
    const res = await request(app).get(`/api/v1/admin/drivers?limit=100`).set('Authorization', `Bearer ${accessToken}`)
    const body = (res.body.data ?? res.body) as { drivers: Array<{ id: string; doc_issues: Array<{ doc_type: string }> }> }
    expect(body.drivers.find((d) => d.id === driverId)!.doc_issues.map((i) => i.doc_type)).toEqual(['insurance'])
  })
})

