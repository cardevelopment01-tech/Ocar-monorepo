# Driver Document Presigned Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 9-10s p99 on driver document/selfie uploads by moving file bytes off the API server entirely — the client uploads straight to S3 via a presigned URL, and the API only ever signs URLs and records metadata.

**Architecture:** Two-phase upload per document: `POST .../upload-init` (auth + validation, returns a presigned S3 `PutObject` URL + a `uploads/pending/...` key, no file bytes touch the server) → client `PUT`s directly to S3 → `POST .../upload-complete` (auth + ownership check on the key, copies the object from `uploads/pending/...` into its permanent `drivers/{id}/...` location, upserts the DB row, returns the same response shape the old endpoint returned). `multer` and the synchronous `uploadFile()` re-upload are removed from all three affected routes (identity docs, vehicle docs, daily-verification selfie/plate). An S3 lifecycle rule (manual AWS console step, documented at the end) reaps any `uploads/pending/` object that never gets completed — no reconciliation job needed.

**Tech Stack:** Express 4 + TypeScript, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (already a dependency), Zod validation, Vitest for unit tests, axios on the driver client (Vite + React).

---

## File structure

- Modify: `api/src/lib/storage.ts` — add `getUploadUrl()` (presigned PUT) and `promotePendingUpload()` (server-side copy pending→permanent, no bytes through the API).
- Modify: `api/src/modules/drivers/drivers.validator.ts` — add init/complete Zod schemas for identity docs, vehicle docs, and daily-verification uploads.
- Modify: `api/src/modules/drivers/drivers.service.ts` — replace `uploadDriverDocument`/`uploadVehicleDocument` with init/complete pairs that include an ownership check on the returned key.
- Modify: `api/src/modules/drivers/drivers.controller.ts` — replace `uploadDocument`/`uploadVehicleDocument` controllers with init/complete controllers.
- Modify: `api/src/modules/drivers/driver-verification.service.ts` — add `initUpload(driverId, kind)` and change `submit()` to take S3 keys instead of `Express.Multer.File`s.
- Modify: `api/src/modules/drivers/driver-verification.controller.ts` — add init controller, change submit controller to read JSON body instead of `req.files`.
- Modify: `api/src/modules/drivers/drivers.routes.ts` — new init/complete routes, remove `multer` entirely (no route uses it after this change).
- Create: `apps/driver/src/lib/s3-upload.ts` — shared `putToS3WithRetry(url, file)` helper (used by both onboarding and daily-verification uploads — real DRY, two call sites from the start, not speculative).
- Modify: `apps/driver/src/lib/onboarding-api.ts` — `uploadDriverDoc`/`uploadVehicleDoc` do init → PUT → complete instead of one multipart POST.
- Modify: `apps/driver/src/lib/driver-verification-api.ts` — `submit()` does init+PUT (selfie, plate in parallel) → submit-with-keys instead of one multipart POST.
- Test: `api/tests/unit/drivers/storage-presigned-upload.test.ts`
- Test: `api/tests/unit/drivers/upload-document-complete.test.ts`

---

### Task 1: `storage.ts` — presigned upload URL + pending→permanent promotion

**Files:**
- Modify: `api/src/lib/storage.ts`
- Test: `api/tests/unit/drivers/storage-presigned-upload.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/drivers/storage-presigned-upload.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn((input) => ({ input, __type: 'PutObjectCommand' })),
  CopyObjectCommand: vi.fn((input) => ({ input, __type: 'CopyObjectCommand' })),
  DeleteObjectCommand: vi.fn((input) => ({ input, __type: 'DeleteObjectCommand' })),
  GetObjectCommand: vi.fn((input) => ({ input, __type: 'GetObjectCommand' })),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/put-url'),
}))
vi.mock('@/config', () => ({
  config: { S3_BUCKET_NAME: 'ocar-docs', S3_REGION: 'ap-south-1', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' },
}))

import { getUploadUrl, promotePendingUpload } from '@/lib/storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

describe('getUploadUrl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('signs a PutObject request with the given key and content type, 5-minute expiry', async () => {
    const url = await getUploadUrl('uploads/pending/drivers/7/profile_photo/abc.jpg', 'image/jpeg')
    expect(url).toBe('https://signed.example.com/put-url')
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'ocar-docs',
          Key: 'uploads/pending/drivers/7/profile_photo/abc.jpg',
          ContentType: 'image/jpeg',
        }),
      }),
      { expiresIn: 300 }
    )
  })
})

describe('promotePendingUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMock.mockResolvedValue({})
  })

  it('copies the pending object into the target folder and deletes the pending copy', async () => {
    const finalUrl = await promotePendingUpload(
      'uploads/pending/drivers/7/profile_photo/abc.jpg',
      'drivers/7/profile_photo'
    )
    expect(sendMock).toHaveBeenCalledTimes(2)
    const copyCall = sendMock.mock.calls[0]![0] as { __type: string; input: Record<string, unknown> }
    expect(copyCall.__type).toBe('CopyObjectCommand')
    expect(copyCall.input['CopySource']).toBe('ocar-docs/uploads/pending/drivers/7/profile_photo/abc.jpg')
    expect(copyCall.input['Key']).toMatch(/^drivers\/7\/profile_photo\/.+\.jpg$/)
    const deleteCall = sendMock.mock.calls[1]![0] as { __type: string; input: Record<string, unknown> }
    expect(deleteCall.__type).toBe('DeleteObjectCommand')
    expect(deleteCall.input['Key']).toBe('uploads/pending/drivers/7/profile_photo/abc.jpg')
    expect(finalUrl).toMatch(/^https:\/\/ocar-docs\.s3\.ap-south-1\.amazonaws\.com\/drivers\/7\/profile_photo\/.+\.jpg$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/drivers/storage-presigned-upload.test.ts`
Expected: FAIL — `getUploadUrl`/`promotePendingUpload` are not exported from `@/lib/storage`.

- [ ] **Step 3: Implement `getUploadUrl` and `promotePendingUpload`**

In `api/src/lib/storage.ts`, add `CopyObjectCommand` to the existing `@aws-sdk/client-s3` import and add both functions after `uploadFile`:

```typescript
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
```

```typescript
export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key, ContentType: contentType }),
    { expiresIn: 300 }
  )
}

export async function promotePendingUpload(pendingKey: string, folder: string): Promise<string> {
  const ext = path.extname(pendingKey) || '.jpg'
  const finalKey = `${folder}/${uuidv4()}${ext}`

  await s3.send(
    new CopyObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      CopySource: `${config.S3_BUCKET_NAME}/${pendingKey}`,
      Key: finalKey,
    })
  )
  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: pendingKey }))

  return `${S3_URL_PREFIX}${finalKey}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/drivers/storage-presigned-upload.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/storage.ts api/tests/unit/drivers/storage-presigned-upload.test.ts
git commit -m "feat(storage): add presigned upload URL + pending-to-permanent promotion"
```

---

### Task 2: Validation schemas for init/complete requests

**Files:**
- Modify: `api/src/modules/drivers/drivers.validator.ts`

- [ ] **Step 1: Add the shared MIME allowlist and four new schemas**

Add near the top of `api/src/modules/drivers/drivers.validator.ts` (after the `z` import):

```typescript
export const ALLOWED_UPLOAD_MIME = ['image/jpeg', 'image/png', 'application/pdf'] as const
```

Replace the existing `identityUploadSchema` and `vehicleUploadSchema` (they described the old multipart request; the new flow needs separate init/complete shapes) with:

```typescript
const IDENTITY_DOC_TYPES = ['profile_photo', 'driving_license', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back'] as const
const VEHICLE_DOC_TYPES  = ['vehicle_rc', 'insurance', 'permit', 'pollution_cert', 'fitness_cert'] as const

export const identityUploadInitSchema = z.object({
  doc_type: z.enum(IDENTITY_DOC_TYPES),
  content_type: z.enum(ALLOWED_UPLOAD_MIME),
})

export const identityUploadCompleteSchema = z.object({
  doc_type: z.enum(IDENTITY_DOC_TYPES),
  key: z.string().min(1),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
})

export const vehicleUploadInitSchema = z.object({
  doc_type: z.enum(VEHICLE_DOC_TYPES),
  content_type: z.enum(ALLOWED_UPLOAD_MIME),
})

export const vehicleUploadCompleteSchema = z.object({
  doc_type: z.enum(VEHICLE_DOC_TYPES),
  key: z.string().min(1),
  doc_number: z.string().max(80).optional(),
  valid_until: z.string().optional(),
})

export const verificationUploadInitSchema = z.object({
  kind: z.enum(['selfie', 'plate']),
  content_type: z.enum(ALLOWED_UPLOAD_MIME),
})

export const verificationSubmitSchema = z.object({
  selfie_key: z.string().min(1),
  plate_key: z.string().min(1),
})
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: errors in `drivers.routes.ts` referencing the now-deleted `identityUploadSchema`/`vehicleUploadSchema` — expected at this point, fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/drivers/drivers.validator.ts
git commit -m "feat(drivers): add init/complete upload validation schemas"
```

---

### Task 3: Service layer — ownership-checked init/complete for identity + vehicle docs

**Files:**
- Modify: `api/src/modules/drivers/drivers.service.ts`
- Test: `api/tests/unit/drivers/upload-document-complete.test.ts`

- [ ] **Step 1: Write the failing test for the ownership check**

```typescript
// api/tests/unit/drivers/upload-document-complete.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://signed.example.com/put'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://ocar-docs.s3.ap-south-1.amazonaws.com/drivers/7/profile_photo/xyz.jpg'),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(`${url}?signed=1`)),
}))
vi.mock('@/modules/drivers/drivers.repository', () => ({
  findDriverById: vi.fn().mockResolvedValue({ id: BigInt(7) }),
  upsertDriverDocument: vi.fn().mockResolvedValue({ doc_type: 'profile_photo', file_url: 'https://ocar-docs.s3.ap-south-1.amazonaws.com/drivers/7/profile_photo/xyz.jpg', status: 'pending' }),
  setReferenceSelfie: vi.fn().mockResolvedValue(undefined),
}))

import { initDriverDocumentUpload, completeDriverDocumentUpload } from '@/modules/drivers/drivers.service'
import { promotePendingUpload } from '@/lib/storage'

describe('initDriverDocumentUpload', () => {
  it('scopes the pending key under the requesting driver only', async () => {
    const { key } = await initDriverDocumentUpload(BigInt(7), 'profile_photo', 'image/jpeg')
    expect(key).toMatch(/^uploads\/pending\/drivers\/7\/profile_photo\/.+\.jpg$/)
  })
})

describe('completeDriverDocumentUpload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('promotes the object and upserts the document when the key belongs to the driver', async () => {
    const key = 'uploads/pending/drivers/7/profile_photo/xyz.jpg'
    const result = await completeDriverDocumentUpload(BigInt(7), key, 'profile_photo')
    expect(promotePendingUpload).toHaveBeenCalledWith(key, 'drivers/7/profile_photo')
    expect(result.doc_type).toBe('profile_photo')
  })

  it('rejects a key that does not belong to the requesting driver', async () => {
    const foreignKey = 'uploads/pending/drivers/99/profile_photo/xyz.jpg'
    await expect(completeDriverDocumentUpload(BigInt(7), foreignKey, 'profile_photo'))
      .rejects.toMatchObject({ appCode: 'AUTH_FORBIDDEN' })
    expect(promotePendingUpload).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/drivers/upload-document-complete.test.ts`
Expected: FAIL — `initDriverDocumentUpload`/`completeDriverDocumentUpload` not exported.

- [ ] **Step 3: Implement in `drivers.service.ts`**

Replace the existing `uploadDriverDocument` function (currently `api/src/modules/drivers/drivers.service.ts:200-223`) with:

```typescript
import { getUploadUrl, promotePendingUpload, getPresignedUrl } from '@/lib/storage'
```

(update the existing import line at the top of the file that currently reads `import { uploadFile, getPresignedUrl } from '@/lib/storage'` — drop `uploadFile`, add `getUploadUrl` and `promotePendingUpload`)

```typescript
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
}

function pendingKey(driverId: bigint, folder: string, contentType: string): string {
  const ext = EXT_BY_MIME[contentType] ?? '.bin'
  return `uploads/pending/drivers/${driverId}/${folder}/${crypto.randomUUID()}${ext}`
}

function assertKeyBelongsToDriver(driverId: bigint, key: string): void {
  if (!key.startsWith(`uploads/pending/drivers/${driverId}/`)) {
    throw createHttpError(AppErrors.AUTH_FORBIDDEN)
  }
}

export async function initDriverDocumentUpload(
  driverId: bigint,
  docType: string,
  contentType: string
): Promise<{ upload_url: string; key: string }> {
  const key = pendingKey(driverId, docType, contentType)
  const uploadUrl = await getUploadUrl(key, contentType)
  return { upload_url: uploadUrl, key }
}

export async function completeDriverDocumentUpload(
  driverId: bigint,
  key: string,
  docType: string,
  validFrom?: string,
  validUntil?: string
): Promise<{ doc_type: string; file_url: string; status: string }> {
  assertKeyBelongsToDriver(driverId, key)

  const driver = await repo.findDriverById(driverId)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  const fileUrl = await promotePendingUpload(key, `drivers/${driverId}/${docType}`)

  const validFromDate  = validFrom  ? new Date(validFrom)  : undefined
  const validUntilDate = validUntil ? new Date(validUntil) : undefined

  const doc = await repo.upsertDriverDocument(driverId, docType, fileUrl, validFromDate, validUntilDate)

  if (docType === 'profile_photo') {
    await repo.setReferenceSelfie(driverId, fileUrl)
  }

  return { doc_type: doc.doc_type, file_url: await getPresignedUrl(doc.file_url), status: doc.status }
}
```

Add `import crypto from 'crypto'` at the top if not already present (check first — `uuidv4()` was previously only used inside `storage.ts`, not here).

Do the same for vehicle documents — replace `uploadVehicleDocument` (`drivers.service.ts:225-241`) with:

```typescript
export async function initVehicleDocumentUpload(
  driverId: bigint,
  docType: string,
  contentType: string
): Promise<{ upload_url: string; key: string }> {
  const vehicle = await repo.findVehicleByDriverId(driverId)
  if (!vehicle) throw httpError(422, 'Complete vehicle info step first', 'STEP_NOT_COMPLETE')
  const key = pendingKey(driverId, `vehicle/${docType}`, contentType)
  const uploadUrl = await getUploadUrl(key, contentType)
  return { upload_url: uploadUrl, key }
}

export async function completeVehicleDocumentUpload(
  driverId: bigint,
  key: string,
  docType: string,
  docNumber?: string,
  validUntil?: string
): Promise<{ doc_type: string; file_url: string; status: string }> {
  assertKeyBelongsToDriver(driverId, key)

  const vehicle = await repo.findVehicleByDriverId(driverId)
  if (!vehicle) throw httpError(422, 'Complete vehicle info step first', 'STEP_NOT_COMPLETE')

  const fileUrl = await promotePendingUpload(key, `drivers/${driverId}/vehicle/${docType}`)
  const validUntilDate = validUntil ? new Date(validUntil) : undefined

  const doc = await repo.upsertVehicleDocument(vehicle.id, docType, fileUrl, docNumber, validUntilDate)
  return { doc_type: doc.doc_type, file_url: await getPresignedUrl(doc.file_url), status: doc.status }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/drivers/upload-document-complete.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: errors remaining only in `drivers.controller.ts` and `drivers.routes.ts` (fixed in Tasks 4-5).

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/drivers/drivers.service.ts api/tests/unit/drivers/upload-document-complete.test.ts
git commit -m "feat(drivers): replace multer upload with ownership-checked init/complete flow"
```

---

### Task 4: Controllers for identity + vehicle document init/complete

**Files:**
- Modify: `api/src/modules/drivers/drivers.controller.ts`

- [ ] **Step 1: Replace `uploadDocument` and `uploadVehicleDocument`**

In `api/src/modules/drivers/drivers.controller.ts`, replace the `uploadDocument` function (lines 69-81) with:

```typescript
export async function uploadDocumentInit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, content_type } = req.body as { doc_type: string; content_type: string }
    const result = await service.initDriverDocumentUpload(req.driver!.id, doc_type, content_type)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function uploadDocumentComplete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, key, valid_from, valid_until } = req.body as {
      doc_type: string; key: string; valid_from?: string; valid_until?: string
    }
    const result = await service.completeDriverDocumentUpload(req.driver!.id, key, doc_type, valid_from, valid_until)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}
```

Replace `uploadVehicleDocument` (lines 83-97) with:

```typescript
export async function uploadVehicleDocumentInit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, content_type } = req.body as { doc_type: string; content_type: string }
    const result = await service.initVehicleDocumentUpload(req.driver!.id, doc_type, content_type)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

export async function uploadVehicleDocumentComplete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_type, key, doc_number, valid_until } = req.body as {
      doc_type: string; key: string; doc_number?: string; valid_until?: string
    }
    const result = await service.completeVehicleDocumentUpload(req.driver!.id, key, doc_type, doc_number, valid_until)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/drivers/drivers.controller.ts
git commit -m "feat(drivers): add init/complete controllers for document upload"
```

---

### Task 5: Daily-verification (selfie + plate) — same pattern

**Files:**
- Modify: `api/src/modules/drivers/driver-verification.service.ts`
- Modify: `api/src/modules/drivers/driver-verification.controller.ts`

- [ ] **Step 1: Rewrite `driver-verification.service.ts`**

```typescript
import { getUploadUrl, promotePendingUpload } from '@/lib/storage'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { findVehicleByDriverId } from './drivers.repository'
import * as repo from './driver-verification.repository'
import type { VerificationStatusToday } from './driver-verification.repository'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
}

export async function getStatus(driverId: bigint): Promise<VerificationStatusToday & { complete: boolean }> {
  const status = await repo.getTodayStatus(driverId)
  return { ...status, complete: status.selfieDone && status.plateDone }
}

export async function initUpload(
  driverId: bigint,
  kind: 'selfie' | 'plate',
  contentType: string
): Promise<{ upload_url: string; key: string }> {
  const ext = EXT_BY_MIME[contentType] ?? '.bin'
  const key = `uploads/pending/drivers/${driverId}/daily-verification/${kind}/${crypto.randomUUID()}${ext}`
  const uploadUrl = await getUploadUrl(key, contentType)
  return { upload_url: uploadUrl, key }
}

function assertKeyBelongsToDriver(driverId: bigint, key: string, kind: 'selfie' | 'plate'): void {
  if (!key.startsWith(`uploads/pending/drivers/${driverId}/daily-verification/${kind}/`)) {
    throw createHttpError(AppErrors.AUTH_FORBIDDEN)
  }
}

export async function submit(
  driverId: bigint,
  keys: { selfieKey: string; plateKey: string }
): Promise<{ complete: true }> {
  assertKeyBelongsToDriver(driverId, keys.selfieKey, 'selfie')
  assertKeyBelongsToDriver(driverId, keys.plateKey, 'plate')

  const vehicle = await findVehicleByDriverId(driverId)
  if (!vehicle) {
    throw httpError(422, 'No registered vehicle found for this driver', 'NO_VEHICLE')
  }

  const folder = `drivers/${driverId}/daily-verification`
  const [selfieUrl, plateUrl] = await Promise.all([
    promotePendingUpload(keys.selfieKey, `${folder}/selfie`),
    promotePendingUpload(keys.plateKey,  `${folder}/plate`),
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

Add `crypto` import (`import crypto from 'crypto'`) at the top.

- [ ] **Step 2: Rewrite `driver-verification.controller.ts`**

```typescript
import { Request, Response, NextFunction } from 'express'
import * as service from './driver-verification.service'

export async function getVerificationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getStatus(req.driver!.id))
  } catch (err) { next(err) }
}

export async function initVerificationUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { kind, content_type } = req.body as { kind: 'selfie' | 'plate'; content_type: string }
    const result = await service.initUpload(req.driver!.id, kind, content_type)
    res.status(200).json(result)
  } catch (err) { next(err) }
}

export async function submitVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { selfie_key, plate_key } = req.body as { selfie_key: string; plate_key: string }
    const result = await service.submit(req.driver!.id, { selfieKey: selfie_key, plateKey: plate_key })
    res.status(201).json(result)
  } catch (err) { next(err) }
}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/drivers/driver-verification.service.ts api/src/modules/drivers/driver-verification.controller.ts
git commit -m "feat(drivers): move daily-verification selfie/plate to presigned upload"
```

---

### Task 6: Wire routes, remove multer entirely

**Files:**
- Modify: `api/src/modules/drivers/drivers.routes.ts`

- [ ] **Step 1: Replace the whole file**

```typescript
import { IRouter, Router } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import { requireDriver } from '@/middleware/role.middleware'
import * as controller from './drivers.controller'
import * as verificationController from './driver-verification.controller'
import {
  updateProfileSchema,
  personalInfoSchema,
  vehicleInfoSchema,
  identityDocumentSchema,
  identityUploadInitSchema,
  identityUploadCompleteSchema,
  vehicleUploadInitSchema,
  vehicleUploadCompleteSchema,
  verificationUploadInitSchema,
  verificationSubmitSchema,
} from './drivers.validator'

const router: IRouter = Router()
const guard = [authenticate(), requireDriver()]
// Daily verification is a pre-shift check for drivers who are already fully
// onboarded — unlike the onboarding routes above, pending/suspended/banned
// drivers shouldn't be able to submit it.
const activeGuard = [authenticate(), requireDriver('active')]

router.get('/me', ...guard, controller.getMe)
router.patch('/me', ...guard, validate(updateProfileSchema), controller.updateMe)

router.get('/onboarding/personal-info',  ...guard, controller.getPersonalInfo)
router.post('/onboarding/personal-info', ...guard, validate(personalInfoSchema), controller.savePersonalInfo)

router.get('/onboarding/vehicle-info',  ...guard, controller.getVehicleInfo)
router.post('/onboarding/vehicle-info', ...guard, validate(vehicleInfoSchema), controller.saveVehicleInfo)

router.post('/onboarding/documents/identity',
  ...guard, validate(identityDocumentSchema), controller.saveIdentityDocuments)

router.post('/onboarding/documents/upload-init',
  ...guard, validate(identityUploadInitSchema), controller.uploadDocumentInit)
router.post('/onboarding/documents/upload-complete',
  ...guard, validate(identityUploadCompleteSchema), controller.uploadDocumentComplete)

router.post('/onboarding/documents/vehicle-upload-init',
  ...guard, validate(vehicleUploadInitSchema), controller.uploadVehicleDocumentInit)
router.post('/onboarding/documents/vehicle-upload-complete',
  ...guard, validate(vehicleUploadCompleteSchema), controller.uploadVehicleDocumentComplete)

router.get('/onboarding/documents/status', ...guard, controller.getDocumentStatus)

router.post('/onboarding/submit', ...guard, controller.submitApplication)

router.get('/daily-verification/status', ...activeGuard, verificationController.getVerificationStatus)
router.post('/daily-verification/upload-init',
  ...activeGuard, validate(verificationUploadInitSchema), verificationController.initVerificationUpload)
router.post('/daily-verification',
  ...activeGuard, validate(verificationSubmitSchema), verificationController.submitVerification)

export default router
```

Note: `multer` import and the `upload`/`ALLOWED_MIME` block are gone entirely — no route in this file uses `req.file`/`req.files` anymore.

- [ ] **Step 2: Full API typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Run the full API test suite**

Run: `cd api && npx vitest run`
Expected: PASS — includes the two new test files plus every pre-existing test (nothing else in the suite touches these routes/functions).

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/drivers/drivers.routes.ts
git commit -m "feat(drivers): wire presigned-upload routes, drop multer"
```

---

### Task 7: Driver app — shared S3 PUT helper with retry

**Files:**
- Create: `apps/driver/src/lib/s3-upload.ts`

- [ ] **Step 1: Implement**

```typescript
import axios from 'axios'

// Plain axios (not the app's `api` instance) -- a presigned S3 URL must not
// carry our Authorization header or get prefixed with our API's baseURL.
// A v4-signed PUT URL is valid for its whole expiry window and can be
// retried against the *same* URL as many times as needed -- only request a
// fresh one (caller's job) if this throws after retries exhaust, which
// usually means the URL actually expired.
export async function putToS3WithRetry(uploadUrl: string, file: File, attempts = 3): Promise<void> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': file.type },
        timeout: 60000,
      })
      return
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i))
      }
    }
  }
  throw lastErr
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/driver/src/lib/s3-upload.ts
git commit -m "feat(driver-app): add shared presigned-PUT-to-S3 retry helper"
```

---

### Task 8: Driver app — onboarding document uploads use init/PUT/complete

**Files:**
- Modify: `apps/driver/src/lib/onboarding-api.ts`

- [ ] **Step 1: Replace `uploadDriverDoc` and `uploadVehicleDoc`**

Add the import at the top:

```typescript
import { putToS3WithRetry } from './s3-upload'
```

Replace `uploadDriverDoc` (currently lines 106-117) with:

```typescript
  uploadDriverDoc: async (file: File, docType: string, validUntil?: string) => {
    const compressed = await compressDocImage(file)
    const { upload_url, key } = (await api.post('/api/v1/drivers/onboarding/documents/upload-init', {
      doc_type: docType,
      content_type: compressed.type,
    })).data as { upload_url: string; key: string }

    await putToS3WithRetry(upload_url, compressed)

    const res = await api.post('/api/v1/drivers/onboarding/documents/upload-complete', {
      doc_type: docType,
      key,
      ...(validUntil ? { valid_until: validUntil } : {}),
    })
    return res.data as { doc_type: string; file_url: string; status: string }
  },
```

Replace `uploadVehicleDoc` (currently lines 119-131) with:

```typescript
  uploadVehicleDoc: async (file: File, docType: string, docNumber?: string, validUntil?: string) => {
    const compressed = await compressDocImage(file)
    const { upload_url, key } = (await api.post('/api/v1/drivers/onboarding/documents/vehicle-upload-init', {
      doc_type: docType,
      content_type: compressed.type,
    })).data as { upload_url: string; key: string }

    await putToS3WithRetry(upload_url, compressed)

    const res = await api.post('/api/v1/drivers/onboarding/documents/vehicle-upload-complete', {
      doc_type: docType,
      key,
      ...(docNumber  ? { doc_number: docNumber }   : {}),
      ...(validUntil ? { valid_until: validUntil } : {}),
    })
    return res.data as { doc_type: string; file_url: string; status: string }
  },
```

- [ ] **Step 2: Commit**

```bash
git add apps/driver/src/lib/onboarding-api.ts
git commit -m "feat(driver-app): switch onboarding document upload to presigned flow"
```

---

### Task 9: Driver app — daily verification selfie/plate use init/PUT/complete

**Files:**
- Modify: `apps/driver/src/lib/driver-verification-api.ts`

- [ ] **Step 1: Replace `submit`**

```typescript
import api from './api'
import { compressImage } from './image-compress'
import { putToS3WithRetry } from './s3-upload'

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.85

export interface DailyVerificationStatus {
  selfieDone: boolean
  plateDone: boolean
  complete: boolean
}

async function uploadOne(file: File, kind: 'selfie' | 'plate'): Promise<string> {
  const { upload_url, key } = (await api.post('/api/v1/drivers/daily-verification/upload-init', {
    kind,
    content_type: file.type,
  })).data as { upload_url: string; key: string }

  await putToS3WithRetry(upload_url, file)
  return key
}

export const driverVerificationApi = {
  getStatus: async (): Promise<DailyVerificationStatus> => {
    const res = await api.get('/api/v1/drivers/daily-verification/status')
    return res.data as DailyVerificationStatus
  },

  submit: async (selfie: File, plate: File): Promise<{ complete: true }> => {
    const [compressedSelfie, compressedPlate] = await Promise.all([
      compressImage(selfie, { maxEdge: MAX_EDGE, quality: JPEG_QUALITY }),
      compressImage(plate,  { maxEdge: MAX_EDGE, quality: JPEG_QUALITY }),
    ])
    const [selfieKey, plateKey] = await Promise.all([
      uploadOne(compressedSelfie, 'selfie'),
      uploadOne(compressedPlate, 'plate'),
    ])
    const res = await api.post('/api/v1/drivers/daily-verification', {
      selfie_key: selfieKey,
      plate_key: plateKey,
    })
    return res.data as { complete: true }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/driver/src/lib/driver-verification-api.ts
git commit -m "feat(driver-app): switch daily-verification upload to presigned flow"
```

---

### Task 10: Driver app typecheck + verification note

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the driver app**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 2: Manual smoke test**

Start the API (`cd api && pnpm dev`) and the driver app (`cd apps/driver && pnpm dev`). Log in as a test driver, go through onboarding document upload (a JPEG and, if you have a sample, a PDF) and daily verification selfie/plate. Confirm:
- Network tab shows two small JSON calls (`-init`, `-complete`) and one `PUT` directly to an `amazonaws.com` URL, not to your own API.
- The document shows up correctly in the admin portal's driver detail view afterward (uses the existing `getPresignedUrl` viewer, unchanged).

- [ ] **Step 3: Add the manual S3 lifecycle note to CLAUDE.md**

In `CLAUDE.md`, under "## Pending Ops Actions", add a new bullet (this is a genuinely manual step — the S3 bucket isn't Terraform-managed, confirmed via `grep -rl aws_s3_bucket infra/terraform`):

```markdown
- **S3 lifecycle rule needed on the docs bucket for `uploads/pending/` orphan cleanup.** The presigned-upload flow (driver document/selfie uploads, see `docs/superpowers/plans/2026-08-14-driver-doc-presigned-upload.md`) writes objects under `uploads/pending/drivers/{driverId}/...` before `*-complete` promotes them to their permanent `drivers/{id}/...` key. If a driver's app closes before calling `*-complete`, the pending object is orphaned (harmless, just wasted storage). Add an S3 lifecycle rule (S3 console → bucket → Management → Lifecycle rules) scoping to prefix `uploads/pending/` with a 1-day expiration. Not code — the docs bucket isn't Terraform-managed (`aws_s3_bucket` doesn't appear anywhere under `infra/terraform`). Delete this note once done.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note manual S3 lifecycle rule for pending-upload cleanup"
```

---

## Explicitly out of scope (don't build these)

- A dedicated worker service/container for anything — every API instance already runs in-process against shared state; nothing here needs a new deployable.
- A reconciliation sweep job for orphaned `uploads/pending/` objects — the S3 lifecycle rule handles it for free.
- Resumable/multipart/chunked upload (S3 multipart API, tus) — files are capped at 10MB and already client-compressed; a single presigned PUT is sufficient.
- Async virus/malware scanning (BullMQ or otherwise) — separately discussed and deliberately deferred; not part of this latency fix.
- A generic reusable "uploads" module/abstraction spanning multiple resource types — three concrete call sites (identity docs, vehicle docs, daily verification), each inlined in its own module, matching how the rest of this codebase is organized.
- PDF-specific client-side compression — flagged as a real contributor to slow uploads, but rasterizing/compressing PDFs in-browser is real added complexity; the presigned-URL change already removes the *server* from being blocked by it. Revisit only if PDF uploads are still a measured pain point after this ships.

## Self-review notes

- **Spec coverage:** presigned URL issuance ✅ (Task 1, 3, 4), ownership/trust-boundary check on `*-complete` ✅ (Task 3, 5, explicitly tested), all three affected routes (identity docs, vehicle docs, daily verification) ✅ (Tasks 3-6, 9), multer fully removed ✅ (Task 6), client retry on the direct S3 PUT ✅ (Task 7), orphan cleanup ✅ (documented lifecycle rule, Task 10), observability ✅ (no dashboard change needed — the existing "Top Routes by Traffic" panel and RED-signal histograms are route-label-driven and will pick up the new `-init`/`-complete` routes automatically once traffic flows through them).
- **Type consistency:** `getUploadUrl(key, contentType)` and `promotePendingUpload(pendingKey, folder)` signatures are used identically across Tasks 1, 3, 5. `initDriverDocumentUpload`/`completeDriverDocumentUpload` and their vehicle/verification equivalents keep consistent parameter order (`driverId` first) throughout.
