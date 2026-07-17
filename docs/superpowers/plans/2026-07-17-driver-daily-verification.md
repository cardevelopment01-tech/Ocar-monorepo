# Driver Daily Selfie + Plate Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a driver to submit a daily selfie + vehicle-plate photo before their first go-online each day; gate the existing go-online flow on it.

**Architecture:** New `driver_verifications` table (reusing the already-defined-but-unused `verification_kind`/`verification_status` enums). A new `driver-verification` sub-module in the drivers domain (repository/service/controller) provides a status-check and a combined-submission endpoint. `rides.service.ts`'s existing `goOnline()` — the single choke point all go-online requests already pass through — gates on today's verification being complete. The driver app checks status before navigating into the existing go-online flow, routing to a new capture screen first when needed.

**Tech Stack:** Express + TypeScript, PostgreSQL, multer (multipart upload), S3 (`uploadFile`), Vitest + Supertest, React (driver app), raw `getUserMedia`/canvas capture (matching the existing onboarding pattern).

**Spec:** `docs/superpowers/specs/2026-07-17-driver-daily-verification-design.md`

---

### Task 1: Migration — `driver_verifications` table

**Files:**
- Create: `api/src/db/migrations/046_driver_verifications.sql`

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/046_driver_verifications.sql`:

```sql
-- ── TABLE: driver_verifications ──────────────────────────────────
-- Daily selfie + plate photo, required before a driver can go online
-- each day. verification_kind/verification_status enums already
-- exist (002_enums.sql) but were never wired to a table until now.
-- MVP: no ML/OCR service exists yet, so submissions are inserted
-- directly as 'auto_passed' — see driver-verification.service.ts.
-- override_by/override_note/overridden_at exist for a future admin
-- review flow; unused for now (no endpoint reads/writes them yet).
CREATE TABLE driver_verifications (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id      BIGINT NOT NULL REFERENCES drivers(id),
  vehicle_id     BIGINT NULL REFERENCES driver_vehicles(id),
  kind           verification_kind NOT NULL,
  verified_for   DATE NOT NULL,
  image_url      TEXT NOT NULL,
  status         verification_status NOT NULL DEFAULT 'pending',
  override_by    BIGINT NULL REFERENCES admins(id),
  override_note  TEXT NULL,
  overridden_at  TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind != 'daily_plate' OR vehicle_id IS NOT NULL)
);

-- One selfie per driver per day
CREATE UNIQUE INDEX driver_verif_selfie_daily_uniq
  ON driver_verifications (driver_id, verified_for)
  WHERE kind = 'daily_selfie';

-- One plate photo per VEHICLE per day (not per driver — a driver could
-- in principle operate different vehicles on different days)
CREATE UNIQUE INDEX driver_verif_plate_daily_uniq
  ON driver_verifications (vehicle_id, verified_for)
  WHERE kind = 'daily_plate';

-- "Has today's verification passed?" lookup — the hot query this feature runs
-- on every go-online attempt
CREATE INDEX driver_verif_today_idx
  ON driver_verifications (driver_id, verified_for, kind)
  WHERE status IN ('passed', 'auto_passed');

-- Admin review queue for any row left pending (should be empty in MVP —
-- monitoring/future-proofing, not an active queue yet)
CREATE INDEX driver_verif_pending_idx
  ON driver_verifications (created_at)
  WHERE status = 'pending';
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: `046_driver_verifications.sql` applied with no errors. Verify with:
```bash
docker exec ocar_postgres psql -U postgres -d ocar -c "\d driver_verifications"
```
Expected: table exists with all columns, the CHECK constraint, and all 4 indexes listed.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/046_driver_verifications.sql
git commit -m "feat: add driver_verifications table for daily selfie+plate check"
```

---

### Task 2: Repository — status check + insert

**Files:**
- Create: `api/src/modules/drivers/driver-verification.repository.ts`

- [ ] **Step 1: Write the repository**

Create `api/src/modules/drivers/driver-verification.repository.ts`:

```typescript
import { pool, withTransaction } from '@/db/client'

const IST = `'Asia/Kolkata'`

// Today's IST calendar date, computed in SQL — matches the existing
// convention used elsewhere in this codebase (e.g. rides.repository.ts,
// analytics.repository.ts) for IST-day boundaries, rather than doing
// timezone math in JS.
const TODAY_IST_EXPR = `(now() AT TIME ZONE ${IST})::date`

export interface VerificationStatusToday {
  selfieDone: boolean
  plateDone: boolean
}

export async function getTodayStatus(driverId: bigint): Promise<VerificationStatusToday> {
  const res = await pool.query<{ kind: string }>(
    `SELECT kind FROM driver_verifications
     WHERE driver_id = $1
       AND verified_for = ${TODAY_IST_EXPR}
       AND status IN ('passed', 'auto_passed')`,
    [driverId]
  )
  const kinds = new Set(res.rows.map((r) => r.kind))
  return {
    selfieDone: kinds.has('daily_selfie'),
    plateDone:  kinds.has('daily_plate'),
  }
}

export async function insertTodayVerification(params: {
  driverId:  bigint
  vehicleId: bigint
  selfieUrl: string
  plateUrl:  string
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status)
       VALUES ($1, NULL, 'daily_selfie', ${TODAY_IST_EXPR}, $2, 'auto_passed')`,
      [params.driverId, params.selfieUrl]
    )
    await client.query(
      `INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status)
       VALUES ($1, $2, 'daily_plate', ${TODAY_IST_EXPR}, $3, 'auto_passed')`,
      [params.driverId, params.vehicleId, params.plateUrl]
    )
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors. (Confirms `pool` and `withTransaction` are both exported from `@/db/client` — they are, per `api/src/db/client.ts`.)

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/drivers/driver-verification.repository.ts
git commit -m "feat: add driver_verifications repository (status check + insert)"
```

---

### Task 3: Service — orchestration

**Files:**
- Create: `api/src/modules/drivers/driver-verification.service.ts`

- [ ] **Step 1: Write the service**

Create `api/src/modules/drivers/driver-verification.service.ts`:

```typescript
import { uploadFile } from '@/lib/storage'
import { findVehicleByDriverId } from './drivers.repository'
import * as repo from './driver-verification.repository'
import type { VerificationStatusToday } from './driver-verification.repository'

export async function getStatus(driverId: bigint): Promise<VerificationStatusToday & { complete: boolean }> {
  const status = await repo.getTodayStatus(driverId)
  return { ...status, complete: status.selfieDone && status.plateDone }
}

export async function submit(
  driverId: bigint,
  files: { selfie: Express.Multer.File; plate: Express.Multer.File }
): Promise<{ complete: true }> {
  const vehicle = await findVehicleByDriverId(driverId)
  if (!vehicle) {
    throw Object.assign(new Error('No registered vehicle found for this driver'), {
      httpStatus: 422, appCode: 'NO_VEHICLE',
    })
  }

  const folder = `drivers/${driverId}/daily-verification`
  const [selfieUrl, plateUrl] = await Promise.all([
    uploadFile(files.selfie, `${folder}/selfie`),
    uploadFile(files.plate,  `${folder}/plate`),
  ])

  await repo.insertTodayVerification({
    driverId,
    vehicleId: BigInt(vehicle.id),
    selfieUrl,
    plateUrl,
  })

  return { complete: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/drivers/driver-verification.service.ts
git commit -m "feat: add driver-verification service (status + submit orchestration)"
```

---

### Task 4: Controller + routes

**Files:**
- Create: `api/src/modules/drivers/driver-verification.controller.ts`
- Modify: `api/src/modules/drivers/drivers.routes.ts`

- [ ] **Step 1: Write the controller**

Create `api/src/modules/drivers/driver-verification.controller.ts`:

```typescript
import { Request, Response, NextFunction } from 'express'
import * as service from './driver-verification.service'

export async function getVerificationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getStatus(req.driver!.id))
  } catch (err) { next(err) }
}

export async function submitVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const files = req.files as { selfie?: Express.Multer.File[]; plate?: Express.Multer.File[] } | undefined
    const selfie = files?.selfie?.[0]
    const plate  = files?.plate?.[0]
    if (!selfie || !plate) {
      res.status(422).json({ error: 'Both selfie and plate photos are required', code: 'VALIDATION_ERROR' })
      return
    }
    const result = await service.submit(req.driver!.id, { selfie, plate })
    res.status(201).json(result)
  } catch (err) { next(err) }
}
```

- [ ] **Step 2: Wire the routes**

In `api/src/modules/drivers/drivers.routes.ts`, add this import after the existing `import * as controller from './drivers.controller'` line:

```typescript
import * as verificationController from './driver-verification.controller'
```

Add this multer instance after the existing `upload` constant (reuses the same `ALLOWED_MIME`/size-limit config, just accepts two named fields instead of one):

```typescript
const uploadVerification = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only JPEG, PNG, and PDF files are allowed'))
    }
  },
})
```

Add these two routes directly before the final `export default router` line:

```typescript
router.get('/daily-verification/status', ...guard, verificationController.getVerificationStatus)
router.post(
  '/daily-verification',
  ...guard,
  uploadVerification.fields([{ name: 'selfie', maxCount: 1 }, { name: 'plate', maxCount: 1 }]),
  verificationController.submitVerification
)
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/drivers/driver-verification.controller.ts api/src/modules/drivers/drivers.routes.ts
git commit -m "feat: add daily-verification status + submit endpoints"
```

---

### Task 5: Gate `goOnline()` on today's verification

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts`

- [ ] **Step 1: Add the import**

In `api/src/modules/rides/rides.service.ts`, add this import after the existing `import * as repo from './rides.repository'` line:

```typescript
import { getTodayStatus } from '@/modules/drivers/driver-verification.repository'
```

- [ ] **Step 2: Add the gate**

Find the start of `goOnline` (currently lines 87-95):

```typescript
export async function goOnline(driverId: bigint, data: {
  mode: 'standard' | 'return_cab'
  vehicleId: bigint
  categoryId: bigint
  lat: number
  lng: number
  destinationCityId?: bigint
}) {
  const existing = await repo.getActiveSession(driverId)
```

Replace it with:

```typescript
export async function goOnline(driverId: bigint, data: {
  mode: 'standard' | 'return_cab'
  vehicleId: bigint
  categoryId: bigint
  lat: number
  lng: number
  destinationCityId?: bigint
}) {
  const verification = await getTodayStatus(driverId)
  if (!verification.selfieDone || !verification.plateDone) {
    throw Object.assign(new Error("Today's selfie and plate verification is required before going online"), {
      httpStatus: 428, appCode: 'DAILY_CHECK_REQUIRED',
    })
  }

  const existing = await repo.getActiveSession(driverId)
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.service.ts
git commit -m "feat: gate goOnline() on today's driver verification"
```

---

### Task 6: Integration tests

**Files:**
- Create: `api/tests/integration/driver-verification.test.ts`

- [ ] **Step 1: Write the tests**

Create `api/tests/integration/driver-verification.test.ts`, following the exact `loginDriver`/fixture/mock pattern already established in `api/tests/integration/m03.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://storage.test/drivers/1/daily-verification/test.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()
const PHONE = '+918200000201'

async function loginDriver(phone: string): Promise<{ accessToken: string; driverId: string }> {
  await redis.del(`otp_rate:${phone}:login`)
  await redis.del(`otp:driver:${phone}:login`)
  const otpRes = await request(app).post('/api/v1/auth/otp/request').send({ phone, role: 'driver' })
  expect(otpRes.status, `OTP request failed: ${JSON.stringify(otpRes.body)}`).toBe(200)
  const { otp } = otpRes.body as { otp: string }
  const verifyRes = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, role: 'driver' })
  expect(verifyRes.status, `OTP verify failed: ${JSON.stringify(verifyRes.body)}`).toBeGreaterThanOrEqual(200)
  const { tokens, principal } = verifyRes.body as { tokens: { accessToken: string }; principal: { id: string } }
  return { accessToken: tokens.accessToken, driverId: principal.id }
}

let categoryId: number
let brandId: number
let modelId: number

beforeAll(async () => {
  const { rows: cats } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = parseInt(cats[0]!.id)
  const { rows: brands } = await pool.query<{ id: string }>("SELECT id FROM vehicle_brands WHERE name = 'Maruti Suzuki' LIMIT 1")
  brandId = parseInt(brands[0]!.id)
  const { rows: models } = await pool.query<{ id: string }>('SELECT id FROM vehicle_models WHERE brand_id = $1 LIMIT 1', [brandId])
  modelId = parseInt(models[0]!.id)
})

afterAll(async () => {
  await pool.query(`DELETE FROM drivers WHERE phone = $1`, [PHONE])
  await redis.del(`otp_rate:${PHONE}:login`)
  await redis.del(`otp:driver:${PHONE}:login`)
  await pool.end()
  redis.disconnect()
})

describe('Driver daily verification', () => {
  let accessToken: string
  let driverId: string

  it('TC-DV-001: new driver has an incomplete status before any submission', async () => {
    const login = await loginDriver(PHONE)
    accessToken = login.accessToken
    driverId = login.driverId

    await pool.query(
      `INSERT INTO driver_vehicles (driver_id, category_id, brand_id, model_id, number_plate, status, is_primary)
       VALUES ($1, $2, $3, $4, 'OD02XX9999', 'active', true)`,
      [driverId, categoryId, brandId, modelId]
    )

    const res = await request(app)
      .get('/api/v1/drivers/daily-verification/status')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ selfieDone: false, plateDone: false, complete: false })
  })

  it('TC-DV-002: going online is blocked with 428 before verification', async () => {
    const vehicleRes = await pool.query<{ id: string }>(
      'SELECT id FROM driver_vehicles WHERE driver_id = $1 LIMIT 1', [driverId]
    )
    const vehicleId = vehicleRes.rows[0]!.id

    const res = await request(app)
      .post('/api/v1/rides/sessions/online')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mode: 'standard', vehicleId: Number(vehicleId), categoryId, lat: 20.29, lng: 85.82 })
    expect(res.status).toBe(428)
    expect(res.body.code).toBe('DAILY_CHECK_REQUIRED')
  })

  it('TC-DV-003: submitting both photos marks today complete and creates two rows', async () => {
    const res = await request(app)
      .post('/api/v1/drivers/daily-verification')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('selfie', Buffer.from('fake-selfie'), { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .attach('plate',  Buffer.from('fake-plate'),  { filename: 'plate.jpg',  contentType: 'image/jpeg' })
    expect(res.status).toBe(201)

    const rows = await pool.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM driver_verifications
       WHERE driver_id = $1 AND verified_for = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
      [driverId]
    )
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.every((r) => r.status === 'auto_passed')).toBe(true)
    expect(new Set(rows.rows.map((r) => r.kind))).toEqual(new Set(['daily_selfie', 'daily_plate']))

    const statusRes = await request(app)
      .get('/api/v1/drivers/daily-verification/status')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(statusRes.body).toEqual({ selfieDone: true, plateDone: true, complete: true })
  })

  it('TC-DV-004: going online succeeds after verification is complete', async () => {
    const vehicleRes = await pool.query<{ id: string }>(
      'SELECT id FROM driver_vehicles WHERE driver_id = $1 LIMIT 1', [driverId]
    )
    const vehicleId = vehicleRes.rows[0]!.id

    const res = await request(app)
      .post('/api/v1/rides/sessions/online')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mode: 'standard', vehicleId: Number(vehicleId), categoryId, lat: 20.29, lng: 85.82 })
    expect(res.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `cd api && npx vitest run tests/integration/driver-verification.test.ts`
Expected: PASS (4 tests). Requires `TEST_DATABASE_URL`/a running local Postgres+Redis per this repo's existing integration-test setup — if unavailable in your environment, note that clearly rather than skipping silently (same caveat noted in `CLAUDE.md`: "API tests: unit only pass cleanly; integration tests need proper TEST_DATABASE_URL").

- [ ] **Step 3: Commit**

```bash
git add api/tests/integration/driver-verification.test.ts
git commit -m "test: add integration tests for daily verification status/submit/goOnline gate"
```

---

### Task 7: Frontend API client

**Files:**
- Create: `apps/driver/src/lib/driver-verification-api.ts`

- [ ] **Step 1: Write the API client**

Create `apps/driver/src/lib/driver-verification-api.ts`:

```typescript
import api from './api'

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.85

// Phone camera photos are commonly several MB — downscale before upload,
// same approach as onboardingApi's compressDocImage.
async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file

    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(bitmap.width  * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export interface DailyVerificationStatus {
  selfieDone: boolean
  plateDone: boolean
  complete: boolean
}

export const driverVerificationApi = {
  getStatus: async (): Promise<DailyVerificationStatus> => {
    const res = await api.get('/api/v1/drivers/daily-verification/status')
    return res.data as DailyVerificationStatus
  },

  submit: async (selfie: File, plate: File): Promise<{ complete: true }> => {
    const [compressedSelfie, compressedPlate] = await Promise.all([
      compressImage(selfie),
      compressImage(plate),
    ])
    const formData = new FormData()
    formData.append('selfie', compressedSelfie)
    formData.append('plate', compressedPlate)
    const res = await api.post('/api/v1/drivers/daily-verification', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return res.data as { complete: true }
  },
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/lib/driver-verification-api.ts
git commit -m "feat: add driver-verification API client"
```

---

### Task 8: Capture screen

**Files:**
- Create: `apps/driver/src/pages/DailyVerification.tsx`

- [ ] **Step 1: Write the component**

Create `apps/driver/src/pages/DailyVerification.tsx`. This reuses the same camera-capture mechanics as `apps/driver/src/pages/Onboarding/ReferenceSelfie.tsx` (raw `getUserMedia` + canvas downscale + JPEG blob) but is intentionally simpler — no oval face-guide overlay, no per-browser permission troubleshooting screens — since this runs daily rather than once, and a plate photo doesn't need a face-framing guide anyway. If camera permission is denied, the user sees a plain retry prompt rather than the full onboarding-flow browser-settings walkthrough.

```tsx
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, RefreshCw } from 'lucide-react'
import { driverVerificationApi } from '@/lib/driver-verification-api'
import OcarSpinner from '@/components/ui/OcarSpinner'

type Step = 'selfie' | 'plate'
type Stage = 'camera' | 'preview'

const STEP_CONFIG: Record<Step, { title: string; instruction: string; facingMode: 'user' | 'environment' }> = {
  selfie: { title: 'Take today’s selfie', instruction: 'Look straight at the camera', facingMode: 'user' },
  plate:  { title: 'Photograph your number plate', instruction: 'Make sure the plate is clearly readable', facingMode: 'environment' },
}

export default function DailyVerification() {
  const navigate = useNavigate()

  const videoRef  = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [step, setStep] = useState<Step>('selfie')
  const [stage, setStage] = useState<Stage>('camera')
  const [cameraReady, setCameraReady] = useState(false)
  const [camError, setCamError] = useState('')
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    void startCamera()
    return stopCamera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function startCamera() {
    setCamError('')
    setCameraReady(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: STEP_CONFIG[step].facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => setCameraReady(true)
      }
    } catch {
      setCamError('Could not access camera. Please check your device settings and try again.')
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return

    const MAX_EDGE = 1280
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
    canvas.width  = Math.round(video.videoWidth  * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (step === 'selfie') {
      // Mirror the selfie to match what the user saw in the preview
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob((blob) => {
      if (!blob) return
      setSelfieBlob(blob)
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
      setStage('preview')
      stopCamera()
    }, 'image/jpeg', 0.85)
  }

  function retake() {
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setSelfieBlob(null)
    setSubmitError('')
    setStage('camera')
    void startCamera()
  }

  const [pendingSelfie, setPendingSelfie] = useState<File | null>(null)

  async function handleNext() {
    if (!selfieBlob) return
    const file = new File([selfieBlob], `${step}.jpg`, { type: 'image/jpeg' })

    if (step === 'selfie') {
      setPendingSelfie(file)
      setSelfieBlob(null)
      setPreviewUrl(null)
      setStep('plate')
      setStage('camera')
      return
    }

    if (!pendingSelfie) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await driverVerificationApi.submit(pendingSelfie, file)
      navigate('/go-online/mode', { replace: true })
    } catch {
      setSubmitError('Submission failed. Please try again.')
      setSubmitting(false)
    }
  }

  function handleBack() {
    if (stage === 'preview') { retake(); return }
    if (step === 'plate') {
      setStep('selfie')
      setStage('camera')
      return
    }
    stopCamera()
    navigate(-1)
  }

  const config = STEP_CONFIG[step]

  return (
    <div
      className="min-h-[100dvh] bg-black flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      <div className="relative z-20 px-5 flex items-center gap-4 pb-3" style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}>
        <button
          onClick={handleBack}
          disabled={submitting}
          className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          aria-label="Go back"
        >
          <ArrowLeft size={18} className="text-white" />
        </button>
        <div className="flex gap-1.5 flex-1">
          <div className={`flex-1 h-1.5 rounded-full ${step === 'selfie' || step === 'plate' ? 'bg-white' : 'bg-white/25'}`} />
          <div className={`flex-1 h-1.5 rounded-full ${step === 'plate' ? 'bg-white' : 'bg-white/25'}`} />
        </div>
      </div>

      {camError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mb-6">
            <Camera size={32} className="text-white/60" />
          </div>
          <h2 className="text-white text-lg font-bold mb-2">Camera unavailable</h2>
          <p className="text-white/60 text-sm leading-relaxed mb-6">{camError}</p>
          <button onClick={() => void startCamera()} className="btn-go w-full flex items-center justify-center gap-2">
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      ) : stage === 'camera' ? (
        <div className="flex-1 flex flex-col">
          <div className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label={`${config.title} camera feed`}
              className="absolute inset-0 w-full h-full object-cover"
              style={step === 'selfie' ? { transform: 'scaleX(-1)' } : undefined}
            />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <OcarSpinner size={40} variant="white" />
              </div>
            )}
            <div className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-black/50 backdrop-blur-md rounded-full px-5 py-2">
                <p className="text-white text-xs font-semibold tracking-wide">{config.title}</p>
              </div>
            </div>
            <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-black/40 backdrop-blur-md rounded-full px-5 py-2.5">
                <p className="text-white/90 text-xs text-center leading-relaxed">{config.instruction}</p>
              </div>
            </div>
          </div>
          <div className="bg-black pt-6 pb-10 flex flex-col items-center gap-3">
            <button
              onClick={capture}
              disabled={!cameraReady}
              aria-label={`Capture ${step}`}
              className="relative flex items-center justify-center disabled:opacity-40"
              style={{ width: 76, height: 76 }}
            >
              <div className="absolute inset-0 rounded-full border-2 border-white/60" />
              <div className="w-[60px] h-[60px] rounded-full bg-white" />
            </button>
            <p className="text-white/70 text-xs">Tap to capture</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="relative flex-1 overflow-hidden">
            {previewUrl && <img src={previewUrl} alt={`${step} preview`} className="absolute inset-0 w-full h-full object-cover" />}
            <div className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-black/50 backdrop-blur-md rounded-full px-5 py-2">
                <p className="text-white text-xs font-semibold tracking-wide">Review your photo</p>
              </div>
            </div>
          </div>
          <div className="bg-black pt-6 pb-10 px-6 flex flex-col gap-3">
            {submitError && <p className="text-red-400 text-xs text-center mb-1">{submitError}</p>}
            <button
              onClick={() => void handleNext()}
              disabled={submitting}
              className="btn-go w-full"
              style={{ minHeight: 52 }}
            >
              {submitting
                ? <span className="flex items-center justify-center gap-2"><OcarSpinner size={16} variant="white" />Submitting…</span>
                : step === 'selfie' ? 'Next: Plate Photo' : 'Submit & Go Online'}
            </button>
            <button
              onClick={retake}
              disabled={submitting}
              className="flex items-center justify-center gap-2 text-white/80 text-sm font-semibold py-3 min-h-[44px] rounded-2xl border border-white/20 disabled:opacity-40"
            >
              <RefreshCw size={14} />
              Retake
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/pages/DailyVerification.tsx
git commit -m "feat: add daily selfie+plate capture screen"
```

---

### Task 9: Wire into routing and the go-online tap handler

**Files:**
- Modify: `apps/driver/src/App.tsx`
- Modify: `apps/driver/src/pages/Home.tsx`

- [ ] **Step 1: Add the route**

In `apps/driver/src/App.tsx`, add this import after the existing `import ReturnCabSetup from '@/pages/GoOnline/ReturnCabSetup'` line:

```typescript
import DailyVerification from '@/pages/DailyVerification'
```

Add this route directly before the `{/* Go online flow */}` comment block:

```tsx
            <Route path="/daily-verification" element={
              <ProtectedRoute requireApproved><DailyVerification /></ProtectedRoute>
            } />

```

- [ ] **Step 2: Gate the go-online tap**

In `apps/driver/src/pages/Home.tsx`, add this import after the existing `import { driverRideApi, type EarningsSummary } from '@/lib/ride-api'` line:

```typescript
import { driverVerificationApi } from '@/lib/driver-verification-api'
```

Find the existing `handleToggle` function:

```typescript
  const handleToggle = () => {
    if (!isOnline) navigate('/go-online/mode')
    else setShowOfflineConfirm(true)
  }
```

Replace it with:

```typescript
  const handleToggle = () => {
    if (!isOnline) {
      driverVerificationApi.getStatus()
        .then((status) => {
          navigate(status.complete ? '/go-online/mode' : '/daily-verification')
        })
        .catch(() => navigate('/go-online/mode')) // status check failed — don't block going online on a network hiccup; goOnline() itself still enforces the gate server-side
    } else {
      setShowOfflineConfirm(true)
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `cd apps/driver && pnpm dev`, log in as a driver whose verification is not yet done for today, tap "Go Online".

Expected:
- Routes to `/daily-verification` instead of `/go-online/mode`.
- Selfie capture step, then plate capture step, submits both, then lands on `/go-online/mode` (the existing flow) on success.
- Tapping "Go Online" again the same day (after completing the check) goes straight to `/go-online/mode`, skipping the capture screen.

- [ ] **Step 5: Commit**

```bash
git add apps/driver/src/App.tsx apps/driver/src/pages/Home.tsx
git commit -m "feat: route to daily verification before go-online when today's check is incomplete"
```

---

## Post-implementation checklist

- [ ] `cd api && npx tsc --noEmit` — clean
- [ ] `cd api && npx vitest run tests/unit` — all passing
- [ ] `cd api && npx vitest run tests/integration/driver-verification.test.ts` — all passing (or explicitly noted as skipped due to missing local Postgres/Redis)
- [ ] `cd apps/driver && npx tsc --noEmit` — clean
- [ ] Manual verification from Task 9 confirmed
