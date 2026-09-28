import { getKpiTotals } from './analytics.repository'
import { cancellationRate, completionRate, istDateOf, rangeFromIstDates } from './kpi-definitions'
import type { KpiTotals } from './kpi-definitions'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { client as redis, withTimeout } from '@/db/redis'
import { adminDigestRunsTotal } from '@/observability/metrics'
import { logger } from '@/lib/logger'

// Daily admin digest (CEO E2/D6): yesterday's numbers (full IST day) from the shared KPI
// definitions. super_admin and finance_admin get five KPIs; ops_admin gets the three without money.
// Delivery is idempotent per IST date and role class: the Redis key is set only AFTER a successful
// send, so a failed send is retried on the next scheduler tick and never duplicates.

export const DIGEST_ROLES = {
  finance: ['super_admin', 'finance_admin'],
  ops: ['ops_admin'],
} as const
export type DigestClass = keyof typeof DIGEST_ROLES

const DEDUPE_TTL_SECONDS = 48 * 3600
const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(Math.round(n))}`
const pct = (r: number) => `${Math.round(r * 100)}%`

export function yesterdayIst(now: Date = new Date()): string {
  const today = istDateOf(now)
  return istDateOf(new Date(rangeFromIstDates(today, today).start.getTime() - 1))
}

export function buildDigestMessage(
  date: string,
  t: KpiTotals,
  cls: DigestClass
): { title: string; body: string } {
  const title = `Ocar daily digest · ${date}`
  if (t.completed_rides === 0 && t.cohort_completed === 0 && t.cohort_cancelled === 0) {
    return { title, body: 'No completed rides yesterday.' }
  }
  const parts = [
    t.completed_rides === 0 ? `0 completed, ${t.cohort_cancelled} cancelled` : `${t.completed_rides} rides completed`,
    `${pct(completionRate(t))} completion`,
    `${pct(cancellationRate(t))} cancelled`,
  ]
  if (cls === 'finance') {
    parts.push(`${inr(t.gross_bookings)} gross bookings`, `${inr(t.commission)} Ocar revenue`)
  }
  return { title, body: parts.join(' · ') }
}

export async function runAdminDigest(now: Date = new Date()): Promise<void> {
  const date = yesterdayIst(now)
  const range = rangeFromIstDates(date, date)
  const totals = await getKpiTotals(range)

  for (const cls of Object.keys(DIGEST_ROLES) as DigestClass[]) {
    const key = `admin-digest:${date}:${cls}`
    let already: string | null
    try {
      already = await withTimeout(redis.get(key))
    } catch (err) {
      // Cannot prove it was not sent: skip rather than risk a duplicate, and make it visible.
      adminDigestRunsTotal.inc({ result: 'failed' })
      logger.error({ err, key }, 'admin digest dedupe check failed, skipping send')
      continue
    }
    if (already) {
      adminDigestRunsTotal.inc({ result: 'skipped_duplicate' })
      continue
    }
    try {
      const msg = buildDigestMessage(date, totals, cls)
      await notifyAllAdmins({
        type: 'admin_daily_digest',
        ...msg,
        payload: { date, class: cls },
        roles: [...DIGEST_ROLES[cls]],
      })
      await withTimeout(redis.set(key, '1', 'EX', DEDUPE_TTL_SECONDS))
      adminDigestRunsTotal.inc({ result: 'sent' })
      logger.info({ date, class: cls }, 'admin digest sent')
    } catch (err) {
      adminDigestRunsTotal.inc({ result: 'failed' })
      logger.error({ err, date, class: cls }, 'admin digest send failed')
    }
  }
}
