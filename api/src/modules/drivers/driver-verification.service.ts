import crypto from 'crypto'
import { getUploadUrl, promotePendingUpload, extractS3Key } from '@/lib/storage'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { getConfigValue } from '@/lib/system-config'
import { logger } from '@/lib/logger'
import { findVehicleByDriverId } from './drivers.repository'
import * as repo from './driver-verification.repository'
import * as provider from './verification.provider'
import { decideFace, decidePlate, type Thresholds } from './verification.decision'
import { rowOutcome, pendingRetake, type VerificationMode } from './verification.policy'
import type { ScoredCheck, VerificationScoring, VerificationStatusToday } from './driver-verification.repository'

const log = logger.child({ module: 'driver-verification' })

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // matches the old multer limits.fileSize

export async function getStatus(driverId: bigint): Promise<VerificationStatusToday & { complete: boolean }> {
  const status = await repo.getTodayStatus(driverId)
  return { ...status, complete: status.selfieDone && status.plateDone }
}

export async function initUpload(
  driverId: bigint,
  kind: 'selfie' | 'plate',
  contentType: string,
  contentLength: number
): Promise<{ upload_url: string; key: string }> {
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw httpError(422, 'File size exceeds 10MB limit', 'FILE_TOO_LARGE')
  }
  const ext = EXT_BY_MIME[contentType] ?? '.bin'
  const key = `uploads/pending/drivers/${driverId}/daily-verification/${kind}/${crypto.randomUUID()}${ext}`
  const uploadUrl = await getUploadUrl(key, contentType, contentLength)
  return { upload_url: uploadUrl, key }
}

function assertKeyBelongsToDriver(driverId: bigint, key: string, kind: 'selfie' | 'plate'): void {
  if (!key.startsWith(`uploads/pending/drivers/${driverId}/daily-verification/${kind}/`)) {
    throw createHttpError(AppErrors.AUTH_FORBIDDEN)
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────
// Mode 'off' keeps today's behaviour. 'shadow' scores both photos with Rekognition and records the result, but the
// rows are still stored as auto_passed, so nothing a driver sees or can do changes. 'flag' also queues low scores
// for an admin and asks the driver to retake an unusable photo; drivers keep working either way. 'block' arrives later.

const SCORING_TIMEOUT_MS = 4000
const FACE_FLOOR_MARGIN = 10 // CompareFaces drops matches under its threshold, so ask lower than the review band

const DEFAULT_THRESHOLDS: Thresholds = {
  facePassMin: 90, faceReviewMin: 75, minBrightness: 35, minSharpness: 35, plateMaxEdits: 1, plateReviewEdits: 2,
}

function num(v: string, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export async function loadThresholds(): Promise<Thresholds> {
  const d = DEFAULT_THRESHOLDS
  const [pass, review, bright, sharp, maxEdits, reviewEdits] = await Promise.all([
    getConfigValue('verification_face_pass_min', String(d.facePassMin)),
    getConfigValue('verification_face_review_min', String(d.faceReviewMin)),
    getConfigValue('verification_min_brightness', String(d.minBrightness)),
    getConfigValue('verification_min_sharpness', String(d.minSharpness)),
    getConfigValue('verification_plate_max_edits', String(d.plateMaxEdits)),
    getConfigValue('verification_plate_review_edits', String(d.plateReviewEdits)),
  ])
  const t: Thresholds = {
    facePassMin: num(pass, d.facePassMin),
    faceReviewMin: num(review, d.faceReviewMin),
    minBrightness: num(bright, d.minBrightness),
    minSharpness: num(sharp, d.minSharpness),
    plateMaxEdits: num(maxEdits, d.plateMaxEdits),
    plateReviewEdits: num(reviewEdits, d.plateReviewEdits),
  }
  // A review band that sits above the pass line makes no sense; fall back to the defaults instead of mis-scoring.
  if (t.faceReviewMin >= t.facePassMin || t.plateReviewEdits < t.plateMaxEdits) return d
  return t
}

// Per-driver override beats the global switch. 'block' is not implemented yet, so it behaves as 'flag' (the nearest
// safe behaviour) rather than turning scoring off or half-enforcing.
export async function resolveMode(modeOverride: string | null): Promise<'off' | VerificationMode> {
  const mode = modeOverride ?? (await getConfigValue('verification_mode', 'off'))
  if (mode === 'shadow') return 'shadow'
  if (mode === 'flag' || mode === 'block') return 'flag'
  return 'off'
}

function errorCheck(reason: string): ScoredCheck {
  return { decision: 'error', reason, similarity: null, faceQuality: null, ocrText: null, ocrConfidence: null }
}

function skippedCheck(reason: string): ScoredCheck {
  return { decision: 'skipped', reason, similarity: null, faceQuality: null, ocrText: null, ocrConfidence: null }
}

export async function scoreSelfie(
  selfieUrl: string,
  referenceUrl: string | null,
  t: Thresholds,
  extraReferenceUrls: string[] = []
): Promise<ScoredCheck> {
  const key = extractS3Key(selfieUrl)
  const refKey = referenceUrl ? extractS3Key(referenceUrl) : null
  if (!key) return skippedCheck('NOT_S3')
  const scan = await provider.detectFaces(key)
  let similarity: number | null = null
  if (scan.faceCount === 1) {
    if (!refKey) return skippedCheck('NO_REFERENCE')
    const floor = Math.max(0, t.faceReviewMin - FACE_FLOOR_MARGIN)
    try {
      similarity = await provider.compareFaces(refKey, key, floor)
      // Extra Rekognition calls only for an uncertain result: when the onboarding photo is not conclusive, an
      // admin-confirmed photo of the same driver may be (different light, beard, glasses). Keep the best score.
      if ((similarity ?? 0) < t.facePassMin) {
        for (const extra of extraReferenceUrls) {
          const extraKey = extractS3Key(extra)
          if (!extraKey) continue
          const s = await provider.compareFaces(extraKey, key, floor).catch(() => null)
          if (s != null && s > (similarity ?? 0)) similarity = s
        }
      }
    } catch (err) {
      const name = (err as { name?: string }).name
      // The stored reference is not a usable face photo (or its object is gone): that is the reference's problem, not
      // the driver's, so record it as skipped rather than as a failed match.
      if (name === 'InvalidParameterException') return skippedCheck('REFERENCE_UNUSABLE')
      if (name === 'InvalidS3ObjectException') return skippedCheck('REFERENCE_MISSING')
      throw err
    }
  }
  const d = decideFace({ faceCount: scan.faceCount, quality: scan.quality, bestSimilarity: similarity }, t)
  return {
    decision: d.decision,
    reason: d.reason,
    similarity,
    faceQuality: scan.quality ? { ...scan.quality } : null,
    ocrText: null,
    ocrConfidence: null,
  }
}

export async function scorePlate(plateUrl: string, registeredPlate: string | null, t: Thresholds): Promise<ScoredCheck> {
  const key = extractS3Key(plateUrl)
  if (!key) return skippedCheck('NOT_S3')
  if (!registeredPlate) return skippedCheck('NO_REGISTERED_PLATE')
  const lines = await provider.detectText(key)
  const d = decidePlate(lines, registeredPlate, t)
  const confidence = lines.length ? lines.reduce((sum, l) => sum + l.confidence, 0) / lines.length : null
  return {
    decision: d.decision, reason: d.reason, similarity: null, faceQuality: null, ocrText: d.text, ocrConfidence: confidence,
  }
}

// Never throws and never takes longer than SCORING_TIMEOUT_MS: a provider problem must not stop a driver's check.
export async function scoreSubmission(args: {
  mode: VerificationMode
  selfieUrl: string
  plateUrl: string
  referenceUrl: string | null
  extraReferenceUrls?: string[]
  registeredPlate: string | null
}): Promise<VerificationScoring> {
  const t = await loadThresholds()
  const settle = (p: Promise<ScoredCheck>, what: string): Promise<ScoredCheck> =>
    p.catch((err: unknown) => {
      log.warn({ err, what }, 'verification scoring failed')
      return errorCheck('PROVIDER_ERROR')
    })
  const work = Promise.all([
    settle(scoreSelfie(args.selfieUrl, args.referenceUrl, t, args.extraReferenceUrls), 'selfie'),
    settle(scorePlate(args.plateUrl, args.registeredPlate, t), 'plate'),
  ])
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<[ScoredCheck, ScoredCheck]>((resolve) => {
    timer = setTimeout(() => resolve([errorCheck('TIMEOUT'), errorCheck('TIMEOUT')]), SCORING_TIMEOUT_MS)
  })
  const [selfie, plate] = await Promise.race([work, timeout]).finally(() => clearTimeout(timer))
  return { mode: args.mode, thresholds: { ...t }, selfie, plate }
}

export type SubmitResult = { complete: true; outcome: 'ok' | 'queued' }

export async function submit(
  driverId: bigint,
  keys: { selfieKey: string; plateKey: string }
): Promise<SubmitResult> {
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

  // Scoring runs before the insert transaction opens, so no DB connection is held while Rekognition is called.
  let scoring: VerificationScoring | undefined
  try {
    const ctx = await repo.getVerificationContext(driverId)
    const mode = await resolveMode(ctx.modeOverride)
    if (mode !== 'off') {
      scoring = await scoreSubmission({
        mode, selfieUrl, plateUrl, referenceUrl: ctx.referenceSelfieUrl,
        extraReferenceUrls: ctx.extraReferenceUrls, registeredPlate: vehicle.number_plate,
      })
    }
  } catch (err) {
    log.warn({ err, driverId: String(driverId) }, 'verification scoring setup failed, storing without a score')
  }

  const vehicleId = BigInt(vehicle.id)
  if (!scoring) {
    await repo.insertTodayVerification({ driverId, vehicleId, selfieUrl, plateUrl })
    return { complete: true, outcome: 'ok' }
  }

  // An unusable photo (no face, too dark, plate not readable) is a retake, not a verdict: nothing is stored as the
  // day's check, only the attempt, so the driver can try again. After retake_max it goes to an admin instead.
  const retakeMax = Math.max(1, Math.trunc(num(await getConfigValue('verification_retake_max', '3'), 3)))
  const retake = pendingRetake(scoring.mode, scoring, await repo.countTodayRetakes(driverId), retakeMax)
  if (retake) {
    await repo.recordAttemptsOnly({ driverId, vehicleId, selfieUrl, plateUrl }, scoring)
    // Only the retake reasons reach the driver (how to fix the photo). Scores and match results never do.
    throw Object.assign(
      httpError(422, 'One of your photos could not be used. Please retake it.', 'VERIFICATION_RETAKE'),
      { details: { selfie: retake.selfie, plate: retake.plate } }
    )
  }

  const outcome = {
    selfie: rowOutcome('selfie', scoring.mode, scoring.selfie.decision),
    plate: rowOutcome('plate', scoring.mode, scoring.plate.decision),
  }
  await repo.insertTodayVerification({ driverId, vehicleId, selfieUrl, plateUrl, scoring, outcome })
  return { complete: true, outcome: outcome.selfie.reviewState === 'queued' || outcome.plate.reviewState === 'queued' ? 'queued' : 'ok' }
}
