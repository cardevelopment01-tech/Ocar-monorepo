import * as repo from '@/modules/rides/rides.repository'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { ROUND_TRIP_OVERTIME_GRACE_MIN } from '@/constants/limits'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'trip-window-nudge-processor' })

export type TripWindowNudgeKind = 't15' | 'end'

export interface TripWindowNudgeJobData {
  rideId: string
  kind: TripWindowNudgeKind
}

const LIVE_STATUSES = new Set(['in_progress', 'returning'])

// Delayed job set when a round trip starts. The ride may have completed, been cancelled or been
// force-resolved in the meantime (the job cannot be cancelled cheaply), so it re-reads the ride and
// does nothing unless the trip is still live. Each recipient is independent: a push failure for
// one never blocks the other, and never retries into a duplicate for the one that worked.
export async function processTripWindowNudge(data: TripWindowNudgeJobData): Promise<void> {
  const rideId = BigInt(data.rideId)
  const ride = await repo.getRideCoreById(rideId)
  if (!ride || !LIVE_STATUSES.has(ride.status)) return

  const context = data.kind === 'end' ? { graceMin: String(ROUND_TRIP_OVERTIME_GRACE_MIN) } : {}
  const type = data.kind === 'end' ? 'trip_window_ended' : 'trip_window_ending'
  const recipients: Array<{ role: 'driver' | 'rider'; ownerType: 'driver' | 'user'; ownerId: bigint | null }> = [
    { role: 'driver', ownerType: 'driver', ownerId: ride.driver_id != null ? BigInt(ride.driver_id) : null },
    { role: 'rider',  ownerType: 'user',   ownerId: BigInt(ride.user_id) },
  ]

  for (const r of recipients) {
    if (r.ownerId == null) continue
    try {
      const { subject, body } = await renderTemplate(`trip_window_${data.kind}_${r.role}`, 'push', context)
      await notifyOwner({
        ownerType: r.ownerType,
        ownerId: r.ownerId,
        type,
        title: subject ?? 'Booked time',
        body,
        rideId,
        // The two nudges replace each other in the tray instead of stacking.
        tag: `trip-window:${data.rideId}`,
      })
    } catch (err) {
      log.error({ err, rideId: data.rideId, kind: data.kind, role: r.role }, 'trip window nudge failed')
    }
  }
}
