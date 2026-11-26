import { client as redis } from '@/db/redis'
import { driverIdleNudgeKey } from '@/constants/redis-keys'
import { logger } from '@/lib/logger'
import { driverIdlePausedTotal } from '@/observability/metrics'
import { notifyOwner } from '@/modules/notifications/notifications.service'

const log = logger.child({ module: 'idle-paused' })

// Long enough that a phone flapping between quiet and live is not buzzed every minute; the push itself lives 3 min (see the registry).
const NUDGE_WINDOW_SECONDS = 30 * 60

export type IdlePauseCause = 'silent' | 'stale_position'

/** The silence sweep just paused an idle driver. Count it, and tell the driver once per session window so they can open the app: a
 *  paused driver sees no ride requests and, until now, was told nothing until the session was ended an hour later. Never throws. */
export async function onIdleDriverPaused(driverId: string, sessionId: string, cause: IdlePauseCause, opts: { nudge?: boolean } = {}): Promise<void> {
  try {
    driverIdlePausedTotal.inc({ cause })
    log.info({ driverId, sessionId, cause }, 'idle driver paused: no usable location')
  } catch (err) {
    log.warn({ err }, 'idle pause metric failed') // a metrics error must never stop the nudge, or become an unhandled rejection
  }
  // A driver already past the offline threshold is ended in the same sweep with its own message; "you're paused" first would only confuse.
  if (opts.nudge === false) return
  const nudgeKey = driverIdleNudgeKey(sessionId)
  try {
    // NX: only the first pause in the window nudges. If Redis is down this throws and the nudge is skipped (best effort).
    if ((await redis.set(nudgeKey, '1', 'EX', NUDGE_WINDOW_SECONDS, 'NX')) !== 'OK') return
    await notifyOwner({
      ownerType: 'driver',
      ownerId: BigInt(driverId),
      type: 'idle_paused',
      title: "You're paused",
      body: "We can't see your location, so ride requests are on hold. Open Ocar to get back to receiving rides.",
    })
  } catch (err) {
    log.warn({ err, driverId }, 'idle pause nudge failed')
    // Release the window so the next sweep can try again: one transient push or DB error must not silence the nudge for 30 minutes.
    await redis.del(nudgeKey).catch(() => undefined)
  }
}
