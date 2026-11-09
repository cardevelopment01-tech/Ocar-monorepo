import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  expireStaleRequestedRide,
  expireStaleAcceptedOrArrivedRide,
  pauseAvailability,
  goOffline,
} from '@/modules/rides/rides.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { socketEvents, isDriverSocketConnected } from '@/websocket/socket.server'
import { client as redis } from '@/db/redis'
import { getConfigValue } from '@/lib/system-config'
import { driverHeartbeatKey, driverSweepPausedKey } from '@/constants/redis-keys'
import {
  STALE_REQUESTED_MINUTES,
  DISPATCH_WATCHDOG_SECONDS,
  STALE_ACCEPTED_HOURS,
  STALE_DRIVER_ARRIVED_HOURS,
  IDLE_HEARTBEAT_PAUSE_SECONDS,
  IDLE_HEARTBEAT_OFFLINE_MINUTES,
  POSITION_MAX_AGE_SECONDS,
  SESSION_POSITION_HARD_LIMIT_SECONDS,
} from '@/constants/limits'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('cleanup')

// Ride stuck in_progress with no driver heartbeat (driver_location_snapshots.recorded_at):
// past FLAG_AFTER_SECONDS -> flag for review, notify rider + admin ops.
// Deliberately does NOT auto-cancel past any further threshold — the driver app
// is a browser tab with no background-GPS capability, so GPS silence past 30
// minutes is close to guaranteed on any real multi-hour trip once the tab
// backgrounds (screen lock, switching to Maps for turn-by-turn). Auto-cancelling
// a live ride on that signal alone force-ends real trips with zero fare to the
// driver. A flagged ride is resolved by a human at ops, never by a timer.
const FLAG_AFTER_SECONDS = 10 * 60

export const cleanupWorker = new Worker(
  QUEUE_NAMES.CLEANUP,
  async () => {
    const staleRides = await repo.findStaleInProgressRides(FLAG_AFTER_SECONDS)

    for (const ride of staleRides) {
      if (!ride.review_flagged_at) {
        await repo.flagRideForReview(BigInt(ride.id), 'gps_stale')
        socketEvents.sendStuckRideFlagged(ride.id, { reason: 'gps_stale' })
      }
    }

    // Orphaned rides that never reached in_progress at all — broadcast job
    // died mid-flight, or driver accepted/arrived and the flow was
    // interrupted (crash, force-quit, network drop) before pickup.
    for (const ride of await repo.findStaleRequestedRides(STALE_REQUESTED_MINUTES)) {
      await expireStaleRequestedRide(BigInt(ride.id))
    }
    // Dispatch watchdog: a flagged ride whose rounds are over and has no open offer is closed now (rider told, offer given back),
    // not after the 20-minute sweep above.
    for (const ride of await repo.findStuckDispatchRides(DISPATCH_WATCHDOG_SECONDS)) {
      log.warn({ rideId: ride.id }, 'dispatch watchdog closing a ride with no live offers')
      try {
        await expireStaleRequestedRide(BigInt(ride.id), 'auto-expired: dispatch watchdog (no round running, no open offers)', true)
      } catch (err) {
        log.error({ err, rideId: ride.id }, 'dispatch watchdog failed for a ride') // one bad ride must not skip the rest of the sweep
      }
    }
    for (const ride of await repo.findStaleAcceptedOrArrivedRides(STALE_ACCEPTED_HOURS, STALE_DRIVER_ARRIVED_HOURS)) {
      await expireStaleAcceptedOrArrivedRide(BigInt(ride.id), ride.status, BigInt(ride.driver_id))
    }

    // Idle-driver heartbeat: the client's own visibilitychange handler
    // (apps/driver/src/App.tsx) is the primary signal and reacts within a second —
    // this sweep only catches drivers who never got to report anything (real crash,
    // OS-killed process, battery death). Short tier pulls them out of the matching
    // pool; only the long tier actually ends the session.
    // A driver whose app says "still here" (a heartbeat in the last 90 s / 10 min, or a live connection right now) is not silent, even if
    // their last location fix is old: a fix can be dropped for poor accuracy, or never come while the driver sits still. Two limits keep
    // that from going too far: a position older than POSITION_MAX_AGE_SECONDS pauses the driver whatever the app says (matching ranks by
    // that position), and an unknown presence answer counts as "not connected" (the old behaviour).
    const lastHeartbeatMs = async (ids: string[]): Promise<Map<string, number>> => {
      const out = new Map<string, number>()
      if (ids.length === 0) return out
      try {
        const vals = await redis.mget(ids.map(driverHeartbeatKey))
        vals.forEach((v, i) => { const n = Number(v); if (v && Number.isFinite(n)) out.set(ids[i]!, n) })
      } catch { /* Redis down: no heartbeats known, old behaviour */ }
      return out
    }
    const connectedAmong = async (ids: string[]): Promise<Set<string>> => {
      const flags = await Promise.all(ids.map((id) => isDriverSocketConnected(id)))
      return new Set(ids.filter((_, i) => flags[i]))
    }
    // Live values (admin settings, cached ~30 s), falling back to the defaults on a missing or unusable value.
    const intSetting = async (key: string, fallback: number, min: number, max: number) => {
      const n = Number(await getConfigValue(key, String(fallback)))
      return Number.isInteger(n) && n >= min && n <= max ? n : fallback
    }
    const pauseSec = await intSetting('driver_idle_pause_seconds', IDLE_HEARTBEAT_PAUSE_SECONDS, 30, 900)
    const offlineSec = (await intSetting('driver_idle_offline_minutes', IDLE_HEARTBEAT_OFFLINE_MINUTES, 5, 240)) * 60
    const posCapSec = Math.max(POSITION_MAX_AGE_SECONDS, pauseSec)
    const hardSec = Math.max(SESSION_POSITION_HARD_LIMIT_SECONDS, offlineSec)
    const quiet90 = await repo.findStaleOnlineDrivers(pauseSec)
    const quiet10 = await repo.findStaleOnlineDrivers(offlineSec)
    const posOldList = posCapSec === offlineSec ? quiet10 : await repo.findStaleOnlineDrivers(posCapSec)
    const posOld = new Set(posOldList.map((d) => d.driver_id))
    const quiet90Ids = quiet90.map((d) => d.driver_id)
    const hb90 = await lastHeartbeatMs(quiet90Ids)
    const conn90 = await connectedAmong(quiet90Ids.filter((id) => !posOld.has(id) && !((hb90.get(id) ?? 0) > Date.now() - pauseSec * 1000)))
    for (const id of quiet90Ids) {
      const alive = (hb90.get(id) ?? 0) > Date.now() - pauseSec * 1000 || conn90.has(id)
      if (alive && !posOld.has(id)) continue
      // Re-check right before acting: a fix or heartbeat can have landed while the lists above were being built.
      if (!(await repo.isDriverStale(BigInt(id), pauseSec))) continue
      // Pauses only a driver who is currently available, and leaves a marker only then, so a heartbeat can resume exactly the drivers the
      // sweep paused (never one who paused on purpose).
      const pausedSession = await repo.pauseIfAvailable(BigInt(id))
      if (pausedSession) await redis.set(driverSweepPausedKey(id), pausedSession, 'EX', 6 * 3600).catch(() => undefined)
    }
    const quiet10Ids = quiet10.map((d) => d.driver_id)
    const hb10 = await lastHeartbeatMs(quiet10Ids)
    const conn10 = await connectedAmong(quiet10Ids.filter((id) => !((hb10.get(id) ?? 0) > Date.now() - offlineSec * 1000)))
    // A position this old ends the session whatever the app says: a heartbeat or a connection shows the app is open, not that the driver can take a ride.
    const hardLimit = new Set((hardSec === offlineSec ? quiet10 : await repo.findStaleOnlineDrivers(hardSec)).map((d) => d.driver_id))
    for (const d of quiet10) {
      const alive = (hb10.get(d.driver_id) ?? 0) > Date.now() - offlineSec * 1000 || conn10.has(d.driver_id)
      if (alive && !hardLimit.has(d.driver_id)) continue
      if (!(await repo.isDriverStale(BigInt(d.driver_id), offlineSec))) continue
      // A driver on a ride is never ended by this sweep (the ride sweep flags a stale ride for a human instead).
      if (await repo.hasActiveRide(BigInt(d.driver_id))) continue
      try {
        await goOffline(BigInt(d.driver_id), 'stale_heartbeat')
        // Hardcoded copy, not a notification_templates row (unlike most other notification
        // types) — deliberately out of scope for this fix; revisit if ops needs to edit this wording.
        await notifyOwner({
          ownerType: 'driver',
          ownerId:   BigInt(d.driver_id),
          type:      'session_ended_stale',
          title:     'You went offline',
          body:      "We lost connection to your device and paused your online status. Tap Go Online to start again.",
          tag:       'session-status',
        }).catch((err: unknown) => log.error({ err, driverId: d.driver_id }, 'stale-offline notify failed'))
      } catch (err) {
        log.error({ err, driverId: d.driver_id }, 'stale-offline sweep failed for a driver') // one bad driver must not skip the rest
      }
    }
  },
  { connection: redisConnection }
)

cleanupWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'cleanup job failed')
})
