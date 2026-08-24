import * as repo from './safety.repository'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'safety-sweeps' })

const SOS_STALE_MINUTES = 5

// §03.4: SOS alerts triggered but never acknowledged for 5+ minutes get pushed
// to every admin (in-app + push + socket via notifyAllAdmins) — a durable
// escalation that doesn't depend on an admin socket being connected at trigger
// time. escalated_at makes it fire once, not every tick.
export async function sweepStaleSosAlerts(): Promise<void> {
  const stale = await repo.getStaleSosAlerts(SOS_STALE_MINUTES)
  for (const alert of stale) {
    try {
      await notifyAllAdmins({
        type: 'sos_unacknowledged',
        title: 'SOS alert unacknowledged for 5+ minutes',
        body: `Ride ${alert.ride_id} — SOS triggered ${new Date(alert.created_at).toISOString()}`,
        rideId: BigInt(alert.ride_id),
      })
      await repo.markSosEscalated(BigInt(alert.id))
    } catch (err) {
      // One bad alert must not abort the rest of the sweep; the next tick retries
      // it (escalated_at still NULL).
      log.error({ err, alertId: alert.id }, 'failed to escalate stale SOS alert')
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
