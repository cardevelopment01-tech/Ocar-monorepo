import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createApp } from '@/app'
import request from 'supertest'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hasApprovedRequiredDocs } from '@/modules/drivers/drivers.repository'
import { findDocIssues } from '@/modules/drivers/doc-issues'
import { loginDriver, seedActiveDriverWithVehicle, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'
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
  const { driverId: id } = await loginDriver(app, redis, PHONE)
  driverId = id
  vehicleId = (await seedActiveDriverWithVehicle(pool, driverId)).vehicleId
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

