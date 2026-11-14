import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { accrueDriverEarning } from '@/modules/payments/submodules/settlements/settlements.service'
import { submitDriverPan } from '@/modules/payments/submodules/settlements/tax-profile.service'
import { loginUser, loginDriver, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// Value: protects=a ride paid online or from the wallet still confirms and records its 194-O TDS row when the driver has a PAN on file;
// fails_when=pan_at_deduction is narrower than the encrypted PAN copied into it (it was VARCHAR(10), the stored value is ~78 chars, so the
// insert failed and rolled back the payment confirmation); why_new=the settlement tests mock the database; seam=none;
// no_claim=the TDS amount maths (covered in accrue-driver-earning.test.ts) and the PAN checksum.

const app = createApp()
const PHONES = { rider: '+919700004001', driver: '+919700004002' } as const

let rideId: string
let driverId: string

beforeAll(async () => {
  const cat = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan'")
  const { accessToken } = await loginUser(app, redis, PHONES.rider)
  const drv = await loginDriver(app, redis, PHONES.driver)
  driverId = drv.driverId
  await submitDriverPan(BigInt(driverId), 'ABCDE1234F')

  const res = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${accessToken}`)
    .send({ categoryId: Number(cat.rows[0]!.id), ...DEFAULT_BOOKING })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  rideId = String(res.body.rideId)

  const ride = await pool.query<{ user_id: string }>('SELECT user_id::text FROM rides WHERE id = $1', [rideId])
  const snap = await pool.query<{ id: string }>('SELECT id::text FROM fare_snapshots WHERE ride_id = $1', [rideId])
  await pool.query(
    `INSERT INTO payments (ride_id, user_id, driver_id, fare_snapshot_id, amount, channel, status)
     VALUES ($1, $2, $3, $4, 300, 'platform_wallet', 'completed')`,
    [rideId, ride.rows[0]!.user_id, driverId, snap.rows[0]!.id]
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM tax_deductions WHERE driver_id = $1', [driverId])
  await pool.query('DELETE FROM driver_earnings WHERE driver_id = $1', [driverId])
  await pool.query('DELETE FROM driver_tax_profile WHERE driver_id = $1', [driverId])
  await pool.query('DELETE FROM payments WHERE ride_id = $1', [rideId])
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

describe('194-O TDS for a driver with a PAN on file', () => {
  it('records the deduction row and the earning entries instead of failing on the PAN column', async () => {
    await accrueDriverEarning(BigInt(rideId), BigInt(driverId))
    const td = await pool.query(
      `SELECT section, tds_amount::float8 AS tds, length(pan_at_deduction) AS pan_len FROM tax_deductions WHERE ride_id = $1`, [rideId])
    expect(td.rows).toHaveLength(1)
    expect(td.rows[0]).toMatchObject({ section: '194O' })
    expect(td.rows[0].pan_len).toBeGreaterThan(10) // the stored PAN is the encrypted value, far longer than the old 10 characters
    const earn = await pool.query(`SELECT entry_type::text FROM driver_earnings WHERE ride_id = $1 ORDER BY entry_type`, [rideId])
    expect(earn.rows.map((r) => r.entry_type)).toEqual(['ride_fare_net', 'tds_deduction'])
  })
})
