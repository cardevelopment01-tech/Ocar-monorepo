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

// Retakes already asked of this driver today, per photo (a count of attempt rows decided 'retake').
export async function countTodayRetakes(driverId: bigint): Promise<{ selfie: number; plate: number }> {
  const rows = await query<{ kind: string; n: string }>(
    `SELECT kind::text, count(*)::text AS n FROM driver_verification_attempts
      WHERE driver_id = $1 AND verified_for = ${TODAY_IST_EXPR} AND decision = 'retake'
      GROUP BY kind`,
    [driverId]
  )
  const n = (kind: string) => Number(rows.find((r) => r.kind === kind)?.n ?? 0)
  return { selfie: n('daily_selfie'), plate: n('daily_plate') }
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

async function insertAttempts(
  client: PoolClient,
  params: { driverId: bigint; vehicleId: bigint; selfieUrl: string; plateUrl: string },
  scoring: VerificationScoring
): Promise<void> {
  // Attempt history survives later retakes that replace the daily row (design decision D4).
  for (const [kind, url, vehicleId, s] of [
    ['daily_selfie', params.selfieUrl, null, scoring.selfie],
    ['daily_plate', params.plateUrl, params.vehicleId, scoring.plate],
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
  scoring: VerificationScoring
): Promise<void> {
  await withTransaction((client) => insertAttempts(client, params, scoring))
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
