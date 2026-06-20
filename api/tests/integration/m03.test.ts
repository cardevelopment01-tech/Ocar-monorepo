import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://storage.test/drivers/1/profile_photo/test.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginDriver(phone: string): Promise<{ accessToken: string; refreshToken: string; driverId: string }> {
  await redis.del(`otp_rate:${phone}:login`)
  await redis.del(`otp:driver:${phone}:login`)

  const otpRes = await request(app)
    .post('/api/v1/auth/otp/request')
    .send({ phone, role: 'driver' })
  expect(otpRes.status, `OTP request failed: ${JSON.stringify(otpRes.body)}`).toBe(200)

  const { otp } = otpRes.body as { otp: string }
  const verifyRes = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp, role: 'driver' })
  expect(verifyRes.status, `OTP verify failed: ${JSON.stringify(verifyRes.body)}`).toBeGreaterThanOrEqual(200)

  const { tokens, principal } = verifyRes.body as {
    tokens: { accessToken: string; refreshToken: string }
    principal: { id: string }
  }
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, driverId: principal.id }
}

const VALID_PERSONAL_INFO = {
  full_name: 'Rajan Kumar',
  gender: 'male',
  date_of_birth: '1990-06-15',
  residential_address: '42 MG Road, Koregaon Park',
  state: 'Maharashtra',
  city: 'Pune',
  pincode: '411001',
  experience_years: 5,
  emergency_contact: '+919900000099',
  languages_known: ['Hindi', 'English'],
}

const VALID_VEHICLE_INFO = {
  category_id: 0,   // filled in beforeAll
  brand_id: 0,      // filled in beforeAll
  vehicle_name: 'Swift LXI',
  model_year: 2020,
  number_plate: 'MH12AB1234',
  color: 'White',
  fuel_type: 'petrol',
  seating_capacity: 4,
  luggage_capacity: 2,
  ac_availability: true,
}

let categoryId: number
let brandId: number

beforeAll(async () => {
  const { rows: cats } = await pool.query<{ id: string }>(
    "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
  )
  categoryId = parseInt(cats[0]!.id)
  const { rows: brands } = await pool.query<{ id: string }>(
    "SELECT id FROM vehicle_brands WHERE name = 'Maruti Suzuki' LIMIT 1"
  )
  brandId = parseInt(brands[0]!.id)
  VALID_VEHICLE_INFO.category_id = categoryId
  VALID_VEHICLE_INFO.brand_id = brandId
})

afterAll(async () => {
  const phones = Array.from({ length: 13 }, (_, i) => `+918100000${String(i + 1).padStart(3, '0')}`)
  await pool.query(`DELETE FROM users WHERE phone = ANY($1)`, [phones])
  await pool.query(`DELETE FROM drivers WHERE phone = ANY($1)`, [phones])
  for (const p of phones) {
    await redis.del(`otp_rate:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

// ── Test cases ────────────────────────────────────────────────────────────────

describe('M03 — Driver Onboarding', () => {
  describe('Driver registration flow', () => {

    it('TC-M03-001: new driver OTP creates drivers row with onboarding_step=personal_info', async () => {
      const phone = '+918100000001'
      const { driverId } = await loginDriver(phone)

      const { rows } = await pool.query<{ onboarding_step: string; status: string }>(
        'SELECT onboarding_step, status FROM drivers WHERE id = $1', [driverId]
      )
      expect(rows[0]?.onboarding_step).toBe('personal_info')
      expect(rows[0]?.status).toBe('pending_docs')
    })

    it('TC-M03-002: personal info save → onboarding_step becomes vehicle_info', async () => {
      const phone = '+918100000002'
      const { accessToken } = await loginDriver(phone)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_PERSONAL_INFO)
      expect(res.status).toBe(200)
      expect(res.body.next_step).toBe('vehicle_info')

      const meRes = await request(app)
        .get('/api/v1/drivers/me')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(meRes.body.onboarding.personal_info_complete).toBe(true)
      expect(meRes.body.onboarding.current_step).toBe('vehicle_info')
    })

    it('TC-M03-003: missing pincode → 422 mentioning pincode', async () => {
      const phone = '+918100000003'
      const { accessToken } = await loginDriver(phone)

      const { pincode: _p, ...withoutPincode } = VALID_PERSONAL_INFO
      const res = await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(withoutPincode)
      expect(res.status).toBe(422)
      expect(JSON.stringify(res.body)).toMatch(/pincode/i)
    })

    it('TC-M03-004: date_of_birth 15 years ago → 422 with age message', async () => {
      const phone = '+918100000004'
      const { accessToken } = await loginDriver(phone)
      const fifteenYearsAgo = new Date()
      fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...VALID_PERSONAL_INFO, date_of_birth: fifteenYearsAgo.toISOString().slice(0, 10) })
      expect(res.status).toBe(422)
      expect(JSON.stringify(res.body)).toMatch(/18/i)
    })

    it('TC-M03-005: emergency_contact = own phone → 422', async () => {
      const phone = '+918100000005'
      const { accessToken } = await loginDriver(phone)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...VALID_PERSONAL_INFO, emergency_contact: phone })
      expect(res.status).toBe(422)
      expect(res.body.error).toMatch(/own number/i)
    })

    it('TC-M03-006: vehicle-info before personal-info → 422 step error', async () => {
      const phone = '+918100000006'
      const { accessToken } = await loginDriver(phone)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/vehicle-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_VEHICLE_INFO)
      expect(res.status).toBe(422)
      expect(res.body.error).toMatch(/personal info/i)
    })

    it('TC-M03-007: vehicle info save after personal info → driver_vehicles row created', async () => {
      const phone = '+918100000007'
      const { accessToken, driverId } = await loginDriver(phone)

      await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_PERSONAL_INFO)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/vehicle-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_VEHICLE_INFO)
      expect(res.status).toBe(200)
      expect(res.body.next_step).toBe('documents')

      const { rows } = await pool.query<{ number_plate: string }>(
        'SELECT number_plate FROM driver_vehicles WHERE driver_id = $1 LIMIT 1', [driverId]
      )
      expect(rows[0]?.number_plate).toBe('MH12AB1234')
    })

    it('TC-M03-008: invalid number plate format → 422', async () => {
      const phone = '+918100000008'
      const { accessToken } = await loginDriver(phone)

      await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_PERSONAL_INFO)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/vehicle-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...VALID_VEHICLE_INFO, number_plate: 'ABCD1234' })
      expect(res.status).toBe(422)
      expect(JSON.stringify(res.body)).toMatch(/plate/i)
    })

    it('TC-M03-009: document upload (profile_photo) → 201, driver_documents row created', async () => {
      const phone = '+918100000009'
      const { accessToken, driverId } = await loginDriver(phone)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('doc_type', 'profile_photo')
        .attach('file', Buffer.alloc(1024), { filename: 'photo.jpg', contentType: 'image/jpeg' })
      expect(res.status).toBe(201)
      expect(res.body.doc_type).toBe('profile_photo')
      expect(res.body.status).toBe('pending')

      const { rows } = await pool.query<{ doc_type: string }>(
        "SELECT doc_type FROM driver_documents WHERE driver_id = $1 AND doc_type = 'profile_photo'",
        [driverId]
      )
      expect(rows).toHaveLength(1)
    })

    it('TC-M03-010: file > 20MB → 422 FILE_TOO_LARGE', async () => {
      const phone = '+918100000010'
      const { accessToken } = await loginDriver(phone)

      const bigFile = Buffer.alloc(21 * 1024 * 1024)
      const res = await request(app)
        .post('/api/v1/drivers/onboarding/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('doc_type', 'profile_photo')
        .attach('file', bigFile, { filename: 'big.jpg', contentType: 'image/jpeg' })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('FILE_TOO_LARGE')
    })

    it('TC-M03-011: submit after all steps complete → pending_approval', async () => {
      const phone = '+918100000011'
      const { accessToken } = await loginDriver(phone)

      // Step 2: personal info
      await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_PERSONAL_INFO)

      // Step 3: vehicle info (unique plate for this test)
      await request(app)
        .post('/api/v1/drivers/onboarding/vehicle-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...VALID_VEHICLE_INFO, number_plate: 'MH12CD5678' })

      // Step 4a: identity doc numbers
      await request(app)
        .post('/api/v1/drivers/onboarding/documents/identity')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ license_number: 'MH0120230012345', aadhaar_number: '123456789012' })

      // Step 4: required photo uploads
      const photoTypes = ['profile_photo', 'driving_license', 'aadhaar_front', 'aadhaar_back']
      for (const dt of photoTypes) {
        await request(app)
          .post('/api/v1/drivers/onboarding/documents/upload')
          .set('Authorization', `Bearer ${accessToken}`)
          .field('doc_type', dt)
          .attach('file', Buffer.alloc(512), { filename: `${dt}.jpg`, contentType: 'image/jpeg' })
      }

      // Step 4b: required vehicle doc uploads
      const vehicleDocTypes = ['vehicle_rc', 'insurance', 'permit']
      for (const dt of vehicleDocTypes) {
        await request(app)
          .post('/api/v1/drivers/onboarding/documents/vehicle-upload')
          .set('Authorization', `Bearer ${accessToken}`)
          .field('doc_type', dt)
          .attach('file', Buffer.alloc(512), { filename: `${dt}.jpg`, contentType: 'image/jpeg' })
      }

      // Submit
      const res = await request(app)
        .post('/api/v1/drivers/onboarding/submit')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('pending_approval')
    })

    it('TC-M03-012: submit with missing documents → 422 with missing array', async () => {
      const phone = '+918100000012'
      const { accessToken } = await loginDriver(phone)

      // Only personal info — skip everything else
      await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_PERSONAL_INFO)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/submit')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(res.status).toBe(422)
      expect(Array.isArray(res.body.missing)).toBe(true)
      expect((res.body.missing as string[]).length).toBeGreaterThan(0)
    })

    it('TC-M03-013: resume flow — personal-info saved, re-fetch shows vehicle_info step', async () => {
      // Reuse phone from TC-M03-002 which already saved personal info
      const phone = '+918100000002'
      const { accessToken } = await loginDriver(phone)

      const meRes = await request(app)
        .get('/api/v1/drivers/me')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(meRes.status).toBe(200)
      expect(meRes.body.onboarding.current_step).toBe('vehicle_info')
      expect(meRes.body.onboarding.personal_info_complete).toBe(true)
    })

  })
})
