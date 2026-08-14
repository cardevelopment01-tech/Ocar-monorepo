import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/drivers/1/profile_photo/test.jpg'),
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

// Two-step presigned flow: init returns 200 + {upload_url, key} (or a 422
// FILE_TOO_LARGE before anything is "uploaded" if contentLength is over the
// cap) -- storage.ts is mocked above, so no real S3 traffic happens here.
async function uploadIdentityDoc(
  accessToken: string, docType: string, contentLength = 512, validUntil?: string
): Promise<request.Response> {
  const initRes = await request(app)
    .post('/api/v1/drivers/onboarding/documents/upload-init')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ doc_type: docType, content_type: 'image/jpeg', content_length: contentLength })
  if (initRes.status !== 200) return initRes
  return request(app)
    .post('/api/v1/drivers/onboarding/documents/upload-complete')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ doc_type: docType, key: initRes.body.key, ...(validUntil ? { valid_until: validUntil } : {}) })
}

async function uploadVehicleDoc(
  accessToken: string, docType: string, contentLength = 512
): Promise<request.Response> {
  const initRes = await request(app)
    .post('/api/v1/drivers/onboarding/documents/vehicle-upload-init')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ doc_type: docType, content_type: 'image/jpeg', content_length: contentLength })
  if (initRes.status !== 200) return initRes
  return request(app)
    .post('/api/v1/drivers/onboarding/documents/vehicle-upload-complete')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ doc_type: docType, key: initRes.body.key })
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
  const phones = Array.from({ length: 16 }, (_, i) => `+918100000${String(i + 1).padStart(3, '0')}`)
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

      const res = await uploadIdentityDoc(accessToken, 'profile_photo', 1024)
      expect(res.status).toBe(201)
      expect(res.body.doc_type).toBe('profile_photo')
      expect(res.body.status).toBe('pending')

      const { rows } = await pool.query<{ doc_type: string }>(
        "SELECT doc_type FROM driver_documents WHERE driver_id = $1 AND doc_type = 'profile_photo'",
        [driverId]
      )
      expect(rows).toHaveLength(1)
    })

    it('TC-M03-010: declared content_length > 10MB → 422 FILE_TOO_LARGE at upload-init', async () => {
      const phone = '+918100000010'
      const { accessToken } = await loginDriver(phone)

      const res = await uploadIdentityDoc(accessToken, 'profile_photo', 11 * 1024 * 1024)
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

      // Step 4: required photo uploads (DL is now split into front + back)
      const photoTypes = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
      for (const dt of photoTypes) {
        await uploadIdentityDoc(accessToken, dt)
      }

      // Step 4b: required vehicle doc uploads
      const vehicleDocTypes = ['vehicle_rc', 'insurance', 'permit']
      for (const dt of vehicleDocTypes) {
        await uploadVehicleDoc(accessToken, dt)
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

    it('TC-M03-014: driving_license_front upload with expiry → 201, doc_type=driving_license_front', async () => {
      const phone = '+918100000014'
      const { accessToken, driverId } = await loginDriver(phone)

      const res = await uploadIdentityDoc(accessToken, 'driving_license_front', 512, '2030-12-31')
      expect(res.status).toBe(201)
      expect(res.body.doc_type).toBe('driving_license_front')
      expect(res.body.status).toBe('pending')

      const { rows } = await pool.query<{ doc_type: string; valid_until: string | null }>(
        "SELECT doc_type, valid_until FROM driver_documents WHERE driver_id = $1 AND doc_type = 'driving_license_front'",
        [driverId]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.valid_until).not.toBeNull()
    })

    it('TC-M03-015: driving_license_back upload without expiry → 201, doc_type=driving_license_back', async () => {
      const phone = '+918100000015'
      const { accessToken, driverId } = await loginDriver(phone)

      const res = await uploadIdentityDoc(accessToken, 'driving_license_back')
      expect(res.status).toBe(201)
      expect(res.body.doc_type).toBe('driving_license_back')
      expect(res.body.status).toBe('pending')

      const { rows } = await pool.query<{ doc_type: string }>(
        "SELECT doc_type FROM driver_documents WHERE driver_id = $1 AND doc_type = 'driving_license_back'",
        [driverId]
      )
      expect(rows).toHaveLength(1)
    })

    it('TC-M03-016: vehicle info with registration_date → persisted to driver_vehicles', async () => {
      const phone = '+918100000016'
      const { accessToken, driverId } = await loginDriver(phone)

      await request(app)
        .post('/api/v1/drivers/onboarding/personal-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(VALID_PERSONAL_INFO)

      const res = await request(app)
        .post('/api/v1/drivers/onboarding/vehicle-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...VALID_VEHICLE_INFO, number_plate: 'OD05XY9999', registration_date: '2021-03-15' })
      expect(res.status).toBe(200)
      expect(res.body.next_step).toBe('documents')

      const { rows } = await pool.query<{ registration_date: string | null }>(
        'SELECT registration_date FROM driver_vehicles WHERE driver_id = $1 LIMIT 1',
        [driverId]
      )
      expect(rows).toHaveLength(1)
      // DATE columns come back as a plain 'YYYY-MM-DD' string (see db/client.ts's
      // type parser) — never round-trip through a JS Date, which is timezone-ambiguous
      // for a value that has no time component.
      expect(rows[0]?.registration_date).toBe('2021-03-15')
    })

  })
})
