import { logger } from '@/lib/logger'

const log = logger.child({ module: 'auth-tables-purge-processor' })

// refresh_tokens gets a row per login AND per rotation (every ~15 min of use per signed-in client) and
// otp_requests a row per OTP request; nothing ever deleted either, so both grew without bound. Revoked/used
// tokens are kept for a while on purpose: reuse detection needs the old row to recognise a replayed token.
const REFRESH_EXPIRED_GRACE_DAYS = 7
const REFRESH_REVOKED_KEEP_DAYS = 30
const OTP_REQUEST_KEEP_DAYS = 2
const BATCH = 5_000
const MAX_BATCHES = 40 // 200k rows per table per run; the next daily run continues if there is more

// Deleted in bounded batches so one run can't hold a long lock or blow the statement timeout on a big backlog.
async function purgeInBatches(sql: string, params: unknown[]): Promise<number> {
  const { pool } = await import('@/db/client')
  let total = 0
  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await pool.query(sql, [...params, BATCH])
    const n = res.rowCount ?? 0
    total += n
    if (n < BATCH) break
  }
  return total
}

export async function processPurgeAuthTables(): Promise<void> {
  const refresh = await purgeInBatches(
    `DELETE FROM refresh_tokens
      WHERE id IN (
        SELECT id FROM refresh_tokens
         WHERE expires_at < now() - ($1 || ' days')::interval
            OR (revoked_at IS NOT NULL AND revoked_at < now() - ($2 || ' days')::interval)
         LIMIT $3)`,
    [REFRESH_EXPIRED_GRACE_DAYS, REFRESH_REVOKED_KEEP_DAYS]
  )
  const otp = await purgeInBatches(
    `DELETE FROM otp_requests
      WHERE id IN (
        SELECT id FROM otp_requests
         WHERE created_at < now() - ($1 || ' days')::interval
         LIMIT $2)`,
    [OTP_REQUEST_KEEP_DAYS]
  )
  log.info({ refreshTokens: refresh, otpRequests: otp }, 'purged expired auth rows')
}
