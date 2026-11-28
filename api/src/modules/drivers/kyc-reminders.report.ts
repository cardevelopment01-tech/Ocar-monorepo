import { pool } from '@/db/client'
import { getConfigValue } from '@/lib/system-config'
import { reminderCycle } from './kyc-reminders.rules'

// The admin view of the onboarding reminders: who is stalled, what was sent, and whether it reached the phone. Everything here is derived from the send
// log, the driver row and notification_logs; nothing is stored for the report itself.

export type SendResult = 'reached' | 'no_device' | 'blocked' | 'problem'
export type DriverState = 'not_due' | 'reminded' | 'paused' | 'came_back'

interface ProviderResponse { successCount?: number; failureCount?: number; invalidTokens?: number }

/** What happened to one push. FCM only confirms it accepted the message, so 'reached' means "handed to the device's push service", never "read". */
export function sendResult(providerResponse: ProviderResponse | null, failureReason: string | null): SendResult {
  if (providerResponse === null && failureReason === null) return 'no_device' // the push worker never found a token to send to
  if ((providerResponse?.successCount ?? 0) > 0) return 'reached'
  if ((providerResponse?.invalidTokens ?? 0) > 0) return 'blocked'
  return 'problem'
}

export function driverState(i: { lastSentAt: Date | null; updatedAt: Date; now: Date; pauseDay: number; firstSentAt?: Date | null; day1?: number; catchUpOn?: boolean }): DriverState {
  if (i.lastSentAt !== null && i.updatedAt > i.lastSentAt) return 'came_back'
  // A driver in a catch-up cycle is paused by that cycle's own clock (its first reminder), not by how long ago their last step was.
  const day1 = i.day1 ?? 1
  const c = reminderCycle({ now: i.now, lastProgressAt: i.updatedAt, days: [day1, day1, day1], pauseDay: i.pauseDay, firstSentAt: i.firstSentAt ?? null, catchUp: false })
  if ((i.now.getTime() - c.anchor.getTime()) / 86_400_000 + c.shift >= i.pauseDay) return 'paused'
  if (c.catchUp && i.catchUpOn === false) return 'paused' // the switch was turned off part way: nothing more will be sent
  return i.lastSentAt === null ? 'not_due' : 'reminded'
}

export interface ReportSend { n: number; sentAt: string; result: SendResult | 'pending' }
export interface ReportRow {
  driverId: string; name: string | null; phone: string; step: string; lastProgressAt: string
  state: DriverState; sends: ReportSend[]; lastResult: SendResult | null
}
export interface Report {
  summary: { stalled: number; reminded: number; cameBack: number; notReached: number }
  rows: ReportRow[]
}
export interface ReportFilter { state?: DriverState; result?: SendResult; step?: string }

/** The first reminder sent after the driver's last step: where a catch-up cycle's clock starts. */
function firstSince(sends: ReportSend[], updatedAt: Date): Date | null {
  const first = sends.find((x) => new Date(x.sentAt) > updatedAt)
  return first ? new Date(first.sentAt) : null
}

export async function listKycReminderReport(filter: ReportFilter = {}, now = new Date()): Promise<Report> {
  const day1 = Number(await getConfigValue('kyc_reminder_day_1', '1')) || 1
  const pauseDay = Number(await getConfigValue('kyc_pause_day', '10')) || 10
  const catchUpOn = (await getConfigValue('kyc_catchup_enabled', 'false')) === 'true'
  const res = await pool.query<{ id: string; full_name: string | null; phone: string; onboarding_step: string; updated_at: Date; sends: Array<{ n: number; sentAt: string; providerResponse: ProviderResponse | null; failureReason: string | null; hasNotification: boolean }> }>(
    `SELECT d.id::text, d.full_name, d.phone, d.onboarding_step, d.updated_at,
            COALESCE((SELECT json_agg(json_build_object('n', s.n, 'sentAt', s.sent_at, 'providerResponse', nl.provider_response, 'failureReason', nl.failure_reason,
                                                         'hasNotification', s.notification_id IS NOT NULL) ORDER BY s.sent_at)
                        FROM driver_kyc_reminder_sends s LEFT JOIN notification_logs nl ON nl.id = s.notification_id
                       WHERE s.driver_id = d.id), '[]'::json) AS sends
       FROM drivers d
      WHERE (d.status = 'pending_docs' AND d.updated_at <= $1::timestamptz - make_interval(days => $2))
         OR EXISTS (SELECT 1 FROM driver_kyc_reminder_sends s WHERE s.driver_id = d.id)
      ORDER BY d.updated_at LIMIT 500`,
    [now.toISOString(), day1])

  const all: ReportRow[] = res.rows.map((r) => {
    const sends: ReportSend[] = r.sends.map((s) => ({ n: s.n, sentAt: s.sentAt, result: s.hasNotification ? sendResult(s.providerResponse, s.failureReason) : 'pending' }))
    const last = sends.length > 0 ? sends[sends.length - 1]! : null
    const updatedAt = new Date(r.updated_at)
    return {
      driverId: r.id, name: r.full_name, phone: r.phone, step: r.onboarding_step, lastProgressAt: updatedAt.toISOString(),
      state: driverState({ lastSentAt: last ? new Date(last.sentAt) : null, updatedAt, now, pauseDay, day1, catchUpOn, firstSentAt: firstSince(sends, updatedAt) }),
      sends, lastResult: last && last.result !== 'pending' ? last.result : null,
    }
  })

  const summary = {
    stalled: all.filter((r) => r.state !== 'came_back').length,
    reminded: all.filter((r) => r.sends.length > 0).length,
    cameBack: all.filter((r) => r.state === 'came_back').length,
    notReached: all.filter((r) => r.lastResult === 'no_device' || r.lastResult === 'blocked' || r.lastResult === 'problem').length,
  }
  const rows = all.filter((r) => (!filter.state || r.state === filter.state) && (!filter.result || r.lastResult === filter.result) && (!filter.step || r.step === filter.step))
  return { summary, rows }
}
