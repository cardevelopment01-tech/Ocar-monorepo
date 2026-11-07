import { query, withTransaction } from '@/db/client'

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
  mode: 'shadow'
  thresholds: Record<string, number>
  selfie: ScoredCheck
  plate: ScoredCheck
}

export interface VerificationContext {
  referenceSelfieUrl: string | null
  modeOverride: string | null
}

export async function getVerificationContext(driverId: bigint): Promise<VerificationContext> {
  const rows = await query<{ reference_selfie_url: string | null; verification_mode_override: string | null }>(
    `SELECT reference_selfie_url, verification_mode_override FROM drivers WHERE id = $1`,
    [driverId]
  )
  return {
    referenceSelfieUrl: rows[0]?.reference_selfie_url ?? null,
    modeOverride: rows[0]?.verification_mode_override ?? null,
  }
}

const SCORE_COLUMNS = `match_similarity, face_quality, ocr_text, ocr_confidence, decision, decision_reason, mode, thresholds`

function scoreValues(s: ScoredCheck | undefined, scoring: VerificationScoring | undefined): unknown[] {
  if (!s || !scoring) return [null, null, null, null, null, null, null, null]
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

export async function insertTodayVerification(params: {
  driverId:  bigint
  vehicleId: bigint
  selfieUrl: string
  plateUrl:  string
  scoring?:  VerificationScoring
}): Promise<void> {
  const { scoring } = params
  // ON CONFLICT DO NOTHING: if a client retries after a lost response (e.g. a
  // dropped mobile connection right after the server committed), the retry
  // is a harmless no-op instead of a 500 from the daily-uniqueness indexes.
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status, ${SCORE_COLUMNS})
       VALUES ($1, NULL, 'daily_selfie', ${TODAY_IST_EXPR}, $2, 'auto_passed', $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (driver_id, verified_for) WHERE kind = 'daily_selfie' DO NOTHING`,
      [params.driverId, params.selfieUrl, ...scoreValues(scoring?.selfie, scoring)]
    )
    await client.query(
      `INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status, ${SCORE_COLUMNS})
       VALUES ($1, $2, 'daily_plate', ${TODAY_IST_EXPR}, $3, 'auto_passed', $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (vehicle_id, verified_for) WHERE kind = 'daily_plate' DO NOTHING`,
      [params.driverId, params.vehicleId, params.plateUrl, ...scoreValues(scoring?.plate, scoring)]
    )
    if (scoring) {
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
  })
}
