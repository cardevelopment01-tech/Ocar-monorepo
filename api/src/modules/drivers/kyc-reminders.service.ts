import { pool } from '@/db/client'
import { logger } from '@/lib/logger'
import { getConfigValue } from '@/lib/system-config'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { offersAllowedNow } from '@/modules/notifications/broadcast.service'
import { nextReminder } from './kyc-reminders.rules'

const log = logger.child({ module: 'kyc-reminders' })

// Onboarding steps in order; the index is how many are finished. Unknown steps are skipped rather than sent a broken message.
export const ONBOARDING_STEPS = ['personal_info', 'vehicle_info', 'documents', 'selfie'] as const
const NEXT_ACTION: Record<string, string> = {
  personal_info: 'Add your details', vehicle_info: 'Add your vehicle', documents: 'Add your documents', selfie: 'Take your selfie',
}
const HEADLINE = ["Let's get started", 'Good start', "You're halfway there", 'One step to go']

const pauseDateLabel = (d: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d)

async function numberConfig(key: string, fallback: number): Promise<number> {
  const n = Number(await getConfigValue(key, String(fallback)))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** One pass of the hourly sweep: sends each stalled driver the reminder they are due, if any. Returns how many went out. */
export async function sendKycReminders(now = new Date()): Promise<number> {
  if ((await getConfigValue('kyc_reminders_enabled', 'false')) !== 'true') return 0
  if (!offersAllowedNow(now)) return 0 // the same 10:00 to 21:00 India-time window marketing messages use

  const days: [number, number, number] = [await numberConfig('kyc_reminder_day_1', 1), await numberConfig('kyc_reminder_day_2', 4), await numberConfig('kyc_reminder_day_3', 8)]
  const pauseDay = await numberConfig('kyc_pause_day', 10)
  const bannerBase = (await getConfigValue('kyc_banner_base_url', '')).trim()

  const rows = await pool.query<{ id: string; onboarding_step: string; updated_at: Date; sent: number }>(
    `SELECT d.id::text, d.onboarding_step, d.updated_at,
            (SELECT count(*) FROM driver_kyc_reminder_sends s WHERE s.driver_id = d.id AND s.sent_at > d.updated_at)::int AS sent
       FROM drivers d
      WHERE d.status = 'pending_docs' AND d.updated_at <= $1::timestamptz - make_interval(days => $2)
      ORDER BY d.updated_at LIMIT 500`,
    [now.toISOString(), days[0]])

  let sent = 0
  for (const row of rows.rows) {
    const done = ONBOARDING_STEPS.indexOf(row.onboarding_step as typeof ONBOARDING_STEPS[number])
    if (done < 0) continue
    const n = nextReminder({ now, lastProgressAt: new Date(row.updated_at), sentSinceProgress: row.sent, enabled: true, days, pauseDay })
    if (n === null) continue

    // Claim first: the one-per-day unique index makes an overlapping sweep a no-op instead of a second message.
    const claim = await pool.query<{ id: string }>(
      `INSERT INTO driver_kyc_reminder_sends (driver_id, n, step, sent_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id::text`,
      [row.id, n, row.onboarding_step, now.toISOString()])
    if (claim.rows.length === 0) continue

    try {
      const pauseDate = pauseDateLabel(new Date(new Date(row.updated_at).getTime() + pauseDay * 86_400_000))
      const slug = `kyc_reminder_${n}${done === 0 ? '_new' : ''}`
      const msg = await renderTemplate(slug, 'push', { headline: HEADLINE[done]!, nextAction: NEXT_ACTION[row.onboarding_step]!, pauseDate })
      const note = await notifyOwner({ ownerType: 'driver', ownerId: BigInt(row.id), type: 'kyc_reminder', title: msg.subject ?? 'Finish your Ocar application', body: msg.body,
        payload: { reminder: String(n), step: row.onboarding_step }, ...(bannerBase ? { imageUrl: `${bannerBase}/kyc-step-${done}.png` } : {}) })
      await pool.query('UPDATE driver_kyc_reminder_sends SET notification_id = $2::bigint WHERE id = $1', [claim.rows[0]!.id, note.id])
      sent++
    } catch (err) {
      log.error({ err, driverId: row.id, n }, 'onboarding reminder failed')
    }
  }
  if (sent > 0) log.info({ sent }, 'onboarding reminders sent')
  return sent
}
