import * as repo from './safety.repository'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'safety-sweeps' })

// The response chain for an alert nobody has acknowledged (the sweep runs every 30 s):
//   at once      every admin is paged by the trigger itself (notifications worker)
//   after 1 min  a reminder to whoever is on call (everyone if nobody is)
//   after 3 min  everyone, once more
// Each step is recorded on the alert (escalation_level) so it fires once, not every tick.
const REMINDER_AFTER_SECONDS = 60
const EVERYONE_AFTER_SECONDS = 180

export async function sweepStaleSosAlerts(): Promise<void> {
  // Highest step first: an alert the sweep missed for minutes gets the one page it needs now, not a reminder and an escalation together.
  for (const [level, afterSeconds] of [[2, EVERYONE_AFTER_SECONDS], [1, REMINDER_AFTER_SECONDS]] as const) {
    const stale = await repo.getUnackedSosAlerts(level, afterSeconds)
    for (const alert of stale) {
      try {
        const waited = Math.max(1, Math.round((Date.now() - new Date(alert.created_at).getTime()) / 60_000))
        const onCall = level === 1 ? (await repo.getOnCallAdmins()).map(a => BigInt(a.id)) : []
        await notifyAllAdmins({
          type: 'sos_unacknowledged',
          title: level === 1 ? 'SOS alert still unacknowledged' : 'SOS alert unacknowledged: all admins',
          body: `Ride ${alert.ride_id}: nobody has picked up this SOS for ${waited} min`,
          rideId: BigInt(alert.ride_id),
          ...(onCall.length > 0 ? { adminIds: onCall } : {}),
        })
        await repo.markSosEscalated(BigInt(alert.id), level)
      } catch (err) {
        // One bad alert must not abort the rest of the sweep; the next tick retries it (level not yet recorded).
        log.error({ err, alertId: alert.id, level }, 'failed to escalate stale SOS alert')
      }
    }
  }
}

// §03.4: disputes past sla_due_at, not resolved, escalated to all admins once.
export async function sweepBreachedDisputeSlas(): Promise<void> {
  const breached = await repo.getBreachedDisputes()
  for (const dispute of breached) {
    try {
      await notifyAllAdmins({
        type: 'dispute_sla_breached',
        title: 'Dispute SLA breached',
        body: `Dispute ${dispute.id} has passed its SLA deadline`,
      })
      await repo.markDisputeSlaEscalated(BigInt(dispute.id))
    } catch (err) {
      log.error({ err, disputeId: dispute.id }, 'failed to escalate breached dispute SLA')
    }
  }
}
