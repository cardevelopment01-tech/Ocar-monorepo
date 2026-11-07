import type { PoolClient } from 'pg'
import { query, withTransaction } from '@/db/client'
import type { RowOutcome, VerificationMode } from './verification.policy'

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
  const rows = await query<{ kind: string }>(
    `SELECT kind FROM driver_verifications
     WHERE driver_id = $1
       AND verified_for = ${TODAY_IST_EXPR}
       AND status IN ('passed', 'auto_passed')`,
    [driverId]
  )
  const kinds = new Set(rows.map((r) => r.kind))
  return {
    selfieDone: kinds.has('daily_selfie'),
    plateDone:  kinds.has('daily_plate'),
  }
}

export type CheckDecision = 'pass' | 'review' | 'fail' | 'retake' | 'error' | 'skipped'

// What the scorer learned about one photo. null fields mean "not measured" (e.g. a plate row has no similarity).
export interface ScoredCheck {
  decision: CheckDecision
  reason: string
  similarity: number | null
  faceQuality: Record<string, number> | null
  ocrText: string | null
  ocrConfidence: number | null
}

export interface VerificationScoring {
  mode: VerificationMode
  thresholds: Record<string, number>
  selfie: ScoredCheck
  plate: ScoredCheck
}

export interface VerificationContext {
  referenceSelfieUrl: string | null
  // Photos an admin confirmed as the real driver, newest first. Only compared when the main reference is unsure.
  extraReferenceUrls: string[]
  modeOverride: string | null
}

const MAX_EXTRA_REFERENCES = 2 // plus the onboarding selfie = 3 in total

export async function getVerificationContext(driverId: bigint): Promise<VerificationContext> {
  const [rows, refs] = await Promise.all([
    query<{ reference_selfie_url: string | null; verification_mode_override: string | null }>(
      `SELECT reference_selfie_url, verification_mode_override FROM drivers WHERE id = $1`,
      [driverId]
    ),
    query<{ image_url: string }>(
      `SELECT image_url FROM driver_face_references WHERE driver_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${MAX_EXTRA_REFERENCES}`,
      [driverId]
    ),
  ])
  return {
    referenceSelfieUrl: rows[0]?.reference_selfie_url ?? null,
    extraReferenceUrls: refs.map((r) => r.image_url),
    modeOverride: rows[0]?.verification_mode_override ?? null,
  }
}

// Retakes already asked of this driver today, per photo (a count of attempt rows decided 'retake'). The daily and the
// re-check kinds count together: a driver's allowance of retakes is per day, not per kind of check.
export async function countTodayRetakes(driverId: bigint): Promise<{ selfie: number; plate: number }> {
  const rows = await query<{ k: string; n: string }>(
    `SELECT CASE WHEN kind::text LIKE '%selfie' THEN 'selfie' ELSE 'plate' END AS k, count(*)::text AS n
       FROM driver_verification_attempts
      WHERE driver_id = $1 AND verified_for = ${TODAY_IST_EXPR} AND decision = 'retake'
      GROUP BY 1`,
    [driverId]
  )
  const n = (k: string) => Number(rows.find((r) => r.k === k)?.n ?? 0)
  return { selfie: n('selfie'), plate: n('plate') }
}

// Selfie mismatches already recorded today (block mode gives a driver a few tries, then an admin decides).
export async function countTodayFailedSelfies(driverId: bigint): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM driver_verification_attempts
      WHERE driver_id = $1 AND verified_for = ${TODAY_IST_EXPR} AND decision = 'fail' AND kind::text LIKE '%selfie'`,
    [driverId]
  )
  return Number(rows[0]?.n ?? 0)
}

const SCORE_COLUMNS = `match_similarity, face_quality, ocr_text, ocr_confidence, decision, decision_reason, mode, thresholds`
const NO_SCORE: unknown[] = [null, null, null, null, null, null, null, null]

function scoreValues(s: ScoredCheck | undefined, scoring: VerificationScoring | undefined): unknown[] {
  if (!s || !scoring) return NO_SCORE
  return [
    s.similarity,
    s.faceQuality ? JSON.stringify(s.faceQuality) : null,
    s.ocrText,
    s.ocrConfidence,
    s.decision,
    s.reason,
    scoring.mode,
    JSON.stringify(scoring.thresholds),
  ]
}

const SHADOW_OUTCOME: RowOutcome = { status: 'auto_passed', reviewState: 'none', priority: 0 }

// A retake after an admin (or, later, block mode) marked the day's row 'failed' must replace it; any other existing
// row is left alone so a client retrying after a lost response is still a harmless no-op.
const REPLACE_FAILED = `DO UPDATE SET
       image_url = EXCLUDED.image_url, status = EXCLUDED.status,
       match_similarity = EXCLUDED.match_similarity, face_quality = EXCLUDED.face_quality,
       ocr_text = EXCLUDED.ocr_text, ocr_confidence = EXCLUDED.ocr_confidence,
       decision = EXCLUDED.decision, decision_reason = EXCLUDED.decision_reason,
       mode = EXCLUDED.mode, thresholds = EXCLUDED.thresholds,
       review_state = EXCLUDED.review_state, review_priority = EXCLUDED.review_priority,
       reviewed_by = NULL, reviewed_at = NULL
     WHERE driver_verifications.status = 'failed'`

export type AttemptKinds = { selfie: 'daily_selfie' | 'spot_selfie'; plate: 'daily_plate' | 'spot_plate' }
const DAILY_KINDS: AttemptKinds = { selfie: 'daily_selfie', plate: 'daily_plate' }

async function insertAttempts(
  client: PoolClient,
  params: { driverId: bigint; vehicleId: bigint; selfieUrl: string; plateUrl: string },
  scoring: VerificationScoring,
  kinds: AttemptKinds = DAILY_KINDS
): Promise<void> {
  // Attempt history survives later retakes that replace the daily row (design decision D4).
  for (const [kind, url, vehicleId, s] of [
    [kinds.selfie, params.selfieUrl, null, scoring.selfie],
    [kinds.plate, params.plateUrl, params.vehicleId, scoring.plate],
  ] as const) {
    await client.query(
      `INSERT INTO driver_verification_attempts
         (driver_id, vehicle_id, kind, verified_for, image_url, decision, decision_reason, match_similarity,
          face_quality, ocr_text, ocr_confidence, mode, thresholds)
       VALUES ($1, $2, $3, ${TODAY_IST_EXPR}, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb)`,
      [
        params.driverId, vehicleId, kind, url, s.decision, s.reason, s.similarity,
        s.faceQuality ? JSON.stringify(s.faceQuality) : null, s.ocrText, s.ocrConfidence,
        scoring.mode, JSON.stringify(scoring.thresholds),
      ]
    )
  }
}

// Stores only the attempt history. Used when the driver is asked to retake: no daily row exists yet.
export async function recordAttemptsOnly(
  params: { driverId: bigint; vehicleId: bigint; selfieUrl: string; plateUrl: string },
  scoring: VerificationScoring,
  kinds: AttemptKinds = DAILY_KINDS
): Promise<void> {
  await withTransaction((client) => insertAttempts(client, params, scoring, kinds))
}

export async function insertTodayVerification(params: {
  driverId:  bigint
  vehicleId: bigint
  selfieUrl: string
  plateUrl:  string
  scoring?:  VerificationScoring
  outcome?:  { selfie: RowOutcome; plate: RowOutcome }
}): Promise<void> {
  const { scoring } = params
  const selfieOut = params.outcome?.selfie ?? SHADOW_OUTCOME
  const plateOut = params.outcome?.plate ?? SHADOW_OUTCOME
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO driver_verifications
         (driver_id, vehicle_id, kind, verified_for, image_url, status, review_state, review_priority, ${SCORE_COLUMNS})
       VALUES ($1, NULL, 'daily_selfie', ${TODAY_IST_EXPR}, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (driver_id, verified_for) WHERE kind = 'daily_selfie' ${REPLACE_FAILED}`,
      [params.driverId, params.selfieUrl, selfieOut.status, selfieOut.reviewState, selfieOut.priority,
        ...scoreValues(scoring?.selfie, scoring)]
    )
    await client.query(
      `INSERT INTO driver_verifications
         (driver_id, vehicle_id, kind, verified_for, image_url, status, review_state, review_priority, ${SCORE_COLUMNS})
       VALUES ($1, $2, 'daily_plate', ${TODAY_IST_EXPR}, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb)
       ON CONFLICT (vehicle_id, verified_for) WHERE kind = 'daily_plate' ${REPLACE_FAILED}`,
      [params.driverId, params.vehicleId, params.plateUrl, plateOut.status, plateOut.reviewState, plateOut.priority,
        ...scoreValues(scoring?.plate, scoring)]
    )
    if (scoring) await insertAttempts(client, params, scoring)
  })
}

// ── Re-check (spot) challenges ────────────────────────────────────────────────

export interface OpenChallenge { id: string; reason: string; openedAt: string }

export async function getOpenChallenge(driverId: bigint): Promise<OpenChallenge | null> {
  const rows = await query<{ id: string; reason: string; opened_at: string }>(
    `SELECT id::text, reason, opened_at::text FROM verification_challenges WHERE driver_id = $1 AND status = 'open'`,
    [driverId]
  )
  const r = rows[0]
  return r ? { id: r.id, reason: r.reason, openedAt: r.opened_at } : null
}

// The unique partial index makes this safe under two rides completing at once: exactly one insert wins.
export async function insertChallengeIfNoneOpen(
  driverId: bigint, reason: 'rides' | 'long_ride', triggerData: Record<string, unknown>
): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `INSERT INTO verification_challenges (driver_id, reason, trigger_data) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (driver_id) WHERE status = 'open' DO NOTHING
     RETURNING id::text`,
    [driverId, reason, JSON.stringify(triggerData)]
  )
  return rows[0]?.id ?? null
}

export async function satisfyChallenge(challengeId: string): Promise<void> {
  await query(
    `UPDATE verification_challenges SET status = 'satisfied', satisfied_at = now() WHERE id = $1 AND status = 'open'`,
    [challengeId]
  )
}

export async function getOrDrawRidesTarget(driverId: bigint, draw: () => number): Promise<number> {
  const rows = await query<{ rides_target: number }>(
    `INSERT INTO driver_spot_check_state (driver_id, rides_target) VALUES ($1, $2)
     ON CONFLICT (driver_id) DO UPDATE SET driver_id = driver_spot_check_state.driver_id
     RETURNING rides_target`,
    [driverId, draw()]
  )
  return rows[0]!.rides_target
}

export async function redrawRidesTarget(driverId: bigint, target: number): Promise<void> {
  await query(
    `INSERT INTO driver_spot_check_state (driver_id, rides_target) VALUES ($1, $2)
     ON CONFLICT (driver_id) DO UPDATE SET rides_target = EXCLUDED.rides_target, drawn_at = now()`,
    [driverId, target]
  )
}

// Newest accepted selfie check of any kind: the point rides are counted from.
export async function lastVerifiedAt(driverId: bigint): Promise<string | null> {
  const rows = await query<{ at: string | null }>(
    `SELECT max(created_at)::text AS at FROM driver_verifications
      WHERE driver_id = $1 AND kind IN ('daily_selfie', 'spot_selfie') AND status IN ('passed', 'auto_passed')`,
    [driverId]
  )
  return rows[0]?.at ?? null
}

export async function countCompletedRidesSince(driverId: bigint, since: string | null): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM rides
      WHERE driver_id = $1 AND status = 'completed' AND completed_at > COALESCE($2::timestamptz, now() - interval '1 day')`,
    [driverId, since]
  )
  return Number(rows[0]?.n ?? 0)
}

// A driver with another ride already accepted or under way is never taken offline (no passenger is stranded).
export async function hasOtherActiveRide(driverId: bigint, exceptRideId: bigint): Promise<boolean> {
  const rows = await query<{ x: number }>(
    `SELECT 1 AS x FROM rides
      WHERE driver_id = $1 AND id <> $2 AND status IN ('accepted', 'driver_arrived', 'in_progress', 'returning') LIMIT 1`,
    [driverId, exceptRideId]
  )
  return rows.length > 0
}

export interface CompletedRideFacts { rideType: string; distanceKm: number | null; durationMin: number | null }

export async function getCompletedRideFacts(rideId: bigint): Promise<CompletedRideFacts | null> {
  const rows = await query<{ ride_type: string; km: string | null; mins: string | null }>(
    `SELECT ride_type::text, actual_distance_km::text AS km,
            COALESCE(actual_duration_min, EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)::text AS mins
       FROM rides WHERE id = $1 AND status = 'completed'`,
    [rideId]
  )
  const r = rows[0]
  if (!r) return null
  return { rideType: r.ride_type, distanceKm: r.km == null ? null : Number(r.km), durationMin: r.mins == null ? null : Number(r.mins) }
}

// Stores a re-check: new spot rows (retakes insert more), and closes the challenge in the same transaction when asked.
export async function insertSpotVerification(params: {
  driverId: bigint
  vehicleId: bigint
  challengeId: string
  selfieUrl: string
  plateUrl: string
  scoring?: VerificationScoring
  outcome: { selfie: RowOutcome; plate: RowOutcome }
  satisfy: boolean
}): Promise<void> {
  const { scoring } = params
  await withTransaction(async (client) => {
    for (const [kind, vehicleId, url, out, s] of [
      ['spot_selfie', null, params.selfieUrl, params.outcome.selfie, scoring?.selfie],
      ['spot_plate', params.vehicleId, params.plateUrl, params.outcome.plate, scoring?.plate],
    ] as const) {
      await client.query(
        `INSERT INTO driver_verifications
           (driver_id, vehicle_id, kind, verified_for, image_url, status, review_state, review_priority, challenge_id, ${SCORE_COLUMNS})
         VALUES ($1, $2, $3, ${TODAY_IST_EXPR}, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16::jsonb)`,
        [params.driverId, vehicleId, kind, url, out.status, out.reviewState, out.priority, params.challengeId,
          ...scoreValues(s, scoring)]
      )
    }
    if (scoring) {
      await insertAttempts(client, params, scoring, { selfie: 'spot_selfie', plate: 'spot_plate' })
    }
    if (params.satisfy) {
      await client.query(
        `UPDATE verification_challenges SET status = 'satisfied', satisfied_at = now() WHERE id = $1 AND status = 'open'`,
        [params.challengeId]
      )
    }
  })
}

// ── Consent ───────────────────────────────────────────────────────────────────

export async function getConsentAt(driverId: bigint): Promise<string | null> {
  const rows = await query<{ at: string | null }>(`SELECT verification_consent_at::text AS at FROM drivers WHERE id = $1`, [driverId])
  return rows[0]?.at ?? null
}

// Keeps the first consent time: agreeing twice (a retry, a reinstall) must not move the evidence.
export async function recordConsent(driverId: bigint, appVersion: string | null): Promise<void> {
  await query(
    `UPDATE drivers SET verification_consent_at = now(), verification_consent_app_version = $2
      WHERE id = $1 AND verification_consent_at IS NULL`,
    [driverId, appVersion]
  )
}
