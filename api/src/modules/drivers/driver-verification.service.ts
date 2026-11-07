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

// reverify / consentRequired are only present when true, so a driver the feature does not touch sees the same body as
// before. An open re-check makes `complete` false so every app version (old ones included) walks to the camera screen.
export type VerificationStatus = VerificationStatusToday & { complete: boolean; reverify?: true; consentRequired?: true }

export async function getStatus(driverId: bigint): Promise<VerificationStatus> {
  const [status, ctx] = await Promise.all([repo.getTodayStatus(driverId), repo.getVerificationContext(driverId)])
  const out: VerificationStatus = { ...status, complete: status.selfieDone && status.plateDone }
  const mode = await resolveMode(ctx.modeOverride)
  if (mode === 'off') return out
  const [challenge, consentAt] = await Promise.all([repo.getOpenChallenge(driverId), repo.getConsentAt(driverId)])
  // Shadow never shows drivers anything, so an open re-check only counts in flag and block.
  if (challenge && mode !== 'shadow') { out.complete = false; out.reverify = true }
  // Shadow is invisible to drivers by design, so only flag and block ask for consent.
  if (!consentAt && mode !== 'shadow') out.consentRequired = true
  return out
}

// The open re-check that must stop this driver going online, or null. Ignored while verification is off, so switching
// the feature off can never leave a driver stuck behind a challenge.
export async function getBlockingChallenge(driverId: bigint): Promise<repo.OpenChallenge | null> {
  const ctx = await repo.getVerificationContext(driverId)
  const mode = await resolveMode(ctx.modeOverride)
  if (mode !== 'flag' && mode !== 'block') return null
  return repo.getOpenChallenge(driverId)
}

export async function acceptConsent(driverId: bigint, appVersion: string | null): Promise<{ ok: true }> {
  await repo.recordConsent(driverId, appVersion)
  return { ok: true }
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
  if (t.faceReviewMin >= t.facePassMin || t.plateReviewEdits < t.plateMaxEdits) {
    log.warn({ configured: t }, 'verification thresholds are inconsistent (review line not below pass line); using defaults')
    return d
  }
  return t
}

// Per-driver override beats the global switch; anything unrecognised reads as off.
export async function resolveMode(modeOverride: string | null): Promise<'off' | VerificationMode> {
  const mode = modeOverride ?? (await getConfigValue('verification_mode', 'off'))
  if (mode === 'shadow' || mode === 'flag' || mode === 'block') return mode
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
const UNREADABLE_IMAGE_ERRORS = new Set(['InvalidImageFormatException', 'InvalidParameterException', 'ImageTooLargeException'])

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
    p.catch((err: unknown): ScoredCheck => {
      // A file Rekognition cannot read as an image is the driver's photo being unusable, not an outage. Treating it as an
      // outage would let a corrupt upload pass the check (fail-open), so it becomes a retake instead.
      const name = (err as { name?: string } | null)?.name
      if (name && UNREADABLE_IMAGE_ERRORS.has(name)) {
        return { decision: 'retake', reason: 'UNREADABLE_IMAGE', similarity: null, faceQuality: null, ocrText: null, ocrConfidence: null }
      }
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

// `outcome` is always 'ok': telling a driver whether their photo was queued would tell an impostor how close they got.
export type SubmitResult = { complete: true; outcome: 'ok' }

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

  // Mode, any open re-check and the driver's remaining tries are read first, so a driver who is out of tries costs no
  // upload and no Rekognition call. A failure to read them falls back to today's behaviour (nothing scored).
  let ctx: repo.VerificationContext | undefined
  let mode: 'off' | VerificationMode = 'off'
  try {
    ctx = await repo.getVerificationContext(driverId)
    mode = await resolveMode(ctx.modeOverride)
  } catch (err) {
    log.warn({ err, driverId: String(driverId) }, 'verification mode lookup failed, storing without a score')
  }
  const retakeMax = Math.max(1, Math.trunc(num(await getConfigValue('verification_retake_max', '3'), 3)))
  const challenge = mode === 'flag' || mode === 'block' ? await repo.getOpenChallenge(driverId) : null
  const failsBefore = mode === 'block' ? await repo.countTodayFailedSelfies(driverId) : 0
  if (mode === 'block' && failsBefore >= retakeMax) {
    throw httpError(422, 'An admin will review your check.', 'VERIFICATION_UNDER_REVIEW')
  }

  // Today's accepted rows, read once: used to skip a pointless resubmit and to recognise a plate-only redo.
  const todayStatus = mode !== 'off' ? await repo.getTodayStatus(driverId) : null

  // Nothing to do when today's check is already accepted and no re-check is open: no upload, no Rekognition call, no
  // new attempt rows. Otherwise a finished driver could resubmit forever (cost) and read the result (a match oracle).
  // A day's row an admin marked failed is not "done", so a redo still goes through.
  if (todayStatus && !challenge && todayStatus.selfieDone && todayStatus.plateDone) return { complete: true, outcome: 'ok' }
  // An admin failed only the plate: the stored selfie row stays (the upsert only replaces failed rows), so the new
  // selfie must not be enforced or the API and the stored day would disagree.
  const plateOnlyRedo = !!todayStatus && !challenge && todayStatus.selfieDone && !todayStatus.plateDone

  const folder = `drivers/${driverId}/daily-verification`
  const [selfieUrl, plateUrl] = await Promise.all([
    promotePendingUpload(keys.selfieKey, `${folder}/selfie`),
    promotePendingUpload(keys.plateKey,  `${folder}/plate`),
  ])

  // Scoring runs before the insert transaction opens, so no DB connection is held while Rekognition is called.
  let scoring: VerificationScoring | undefined
  if (ctx && mode !== 'off') {
    try {
      scoring = await scoreSubmission({
        mode, selfieUrl, plateUrl, referenceUrl: ctx.referenceSelfieUrl,
        extraReferenceUrls: ctx.extraReferenceUrls, registeredPlate: vehicle.number_plate,
      })
    } catch (err) {
      log.warn({ err, driverId: String(driverId) }, 'verification scoring setup failed, storing without a score')
    }
  }

  const vehicleId = BigInt(vehicle.id)
  if (!scoring) {
    await repo.insertTodayVerification({ driverId, vehicleId, selfieUrl, plateUrl })
    if (challenge) await repo.satisfyChallenge(challenge.id) // fail open: an outage must not strand a driver offline
    return { complete: true, outcome: 'ok' }
  }

  // With an open re-check and today's daily check already done, this submission is the re-check: new spot rows. In any
  // other case it is the daily check (an open re-check is closed by it too, since the photos are fresh).
  const daily = challenge ? await repo.getTodayStatus(driverId) : null
  const spotPath = !!challenge && !!daily && daily.selfieDone && daily.plateDone
  const attemptKinds = spotPath ? ({ selfie: 'spot_selfie', plate: 'spot_plate' } as const) : undefined

  // An unusable photo (no face, too dark, plate not readable) is a retake, not a verdict: nothing is stored as the
  // check, only the attempt, so the driver can try again. After retake_max it goes to an admin instead.
  const retake = pendingRetake(scoring.mode, scoring, await repo.countTodayRetakes(driverId), retakeMax)
  if (retake) {
    await repo.recordAttemptsOnly({ driverId, vehicleId, selfieUrl, plateUrl }, scoring, attemptKinds)
    // Only the retake reasons reach the driver (how to fix the photo). Scores and match results never do.
    throw Object.assign(
      httpError(422, 'One of your photos could not be used. Please retake it.', 'VERIFICATION_RETAKE'),
      { details: { selfie: retake.selfie, plate: retake.plate } }
    )
  }

  // Block mode: a selfie that is still unusable after every allowed retake must not pass by wearing the driver out
  // (four dark photos in a row). It counts as a mismatch, so the tries-left counter and the admin step apply.
  if (scoring.mode === 'block' && scoring.selfie.decision === 'retake') {
    scoring.selfie = { ...scoring.selfie, decision: 'fail', reason: 'RETAKE_LIMIT' }
  }

  const outcome = {
    selfie: rowOutcome('selfie', scoring.mode, scoring.selfie.decision),
    plate: rowOutcome('plate', scoring.mode, scoring.plate.decision),
  }
  // Only a selfie that did not match in block mode keeps the re-check open; everything else closes it.
  const selfieBlocked = outcome.selfie.status === 'failed' && !plateOnlyRedo
  if (spotPath && challenge) {
    await repo.insertSpotVerification({
      driverId, vehicleId, challengeId: challenge.id, selfieUrl, plateUrl, scoring, outcome, satisfy: !selfieBlocked,
    })
  } else {
    await repo.insertTodayVerification({ driverId, vehicleId, selfieUrl, plateUrl, scoring, outcome })
    if (challenge && !selfieBlocked) await repo.satisfyChallenge(challenge.id)
  }

  if (selfieBlocked) {
    // The wording says retake, never why: scores and match reasons are not shown to drivers.
    throw Object.assign(
      httpError(422, "We couldn't verify this photo.", 'VERIFICATION_FAILED'),
      { details: { attemptsLeft: Math.max(0, retakeMax - (failsBefore + 1)) } }
    )
  }
  return { complete: true, outcome: 'ok' }
}
