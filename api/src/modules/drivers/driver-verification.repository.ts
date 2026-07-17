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
