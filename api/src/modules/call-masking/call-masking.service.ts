import { config } from '@/config'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { getConfigValue } from '@/lib/system-config'
import { invalidate } from '@/lib/cache/reference-cache'
import { configKey } from '@/constants/redis-keys'
import { getRideById } from '@/modules/rides/rides.repository'
import { createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as ivr from '@/modules/call-masking/call-masking.bulksmsplans-client'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { CallMaskingError, type CallerRole } from '@/modules/call-masking/call-masking.types'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('call-masking')

// bulksmsplans has one shared virtual number for the whole account, not a
// rented pool of numbers like Exotel — there is nothing to reserve per ride
// and nothing to hand back. allocateForRide/releaseForRide stay as no-ops
// (rather than deleting their 8 call sites across rides.service.ts) purely
// so this swap doesn't touch the ride lifecycle file at all.
export async function allocateForRide(_params: {
  rideId: bigint
  driverPhone: string
  riderPhone: string
}): Promise<void> {}

export async function releaseForRide(_rideId: bigint): Promise<void> {}

// Rides in these statuses have an active driver<->rider relationship worth
// bridging a call for.
const CALL_ELIGIBLE_STATUSES = ['accepted', 'driver_arrived', 'in_progress', 'returning']

const CALL_COUNT_TTL_SECONDS = 24 * 60 * 60 // no real ride runs longer than this

export async function triggerCall(params: {
  rideId: bigint
  callerRole: CallerRole
  callerId: bigint
}): Promise<void> {
  const enabled = await getConfigValue('call_masking_enabled', 'false')
  if (enabled !== 'true') {
    throw new CallMaskingError('MASKING_DISABLED', 'Masked calling is currently disabled')
  }
  // Fail fast rather than burn the ride's attempt budget on a call the vendor
  // can't take: empty creds/IVR number mean the env was never configured.
  if (!config.BULKSMSPLANS_API_ID || !config.BULKSMSPLANS_API_PASSWORD || !config.BULKSMSPLANS_IVR_NUMBER) {
    log.error('call masking enabled but BULKSMSPLANS_API_ID/PASSWORD/IVR_NUMBER not configured')
    throw new CallMaskingError('MASKING_DISABLED', 'Masked calling is currently disabled')
  }

  // Mirrors ride-chat.service.ts's resolveParticipant: the caller must
  // actually be the rider or driver on this ride, otherwise any
  // authenticated user/driver could trigger a real, billed call between two
  // strangers.
  const ride = await getRideById(params.rideId)
  if (!ride) throw createHttpError(AppErrors.RIDE_NOT_FOUND)
  const isOwner =
    (params.callerRole === 'user' && String(ride.user_id) === String(params.callerId)) ||
    (params.callerRole === 'driver' && ride.driver_id !== null && String(ride.driver_id) === String(params.callerId))
  if (!isOwner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

  if (!CALL_ELIGIBLE_STATUSES.includes(ride.status)) {
    throw new CallMaskingError('CALL_NOT_AVAILABLE', 'Calling is only available during an active ride')
  }

  const riderPhone = ride.rider_phone ?? ride.user_phone
  const driverPhone = ride.driver_phone
  if (!riderPhone || !driverPhone) {
    throw new CallMaskingError('CALL_NOT_AVAILABLE', 'No phone number on file for the other party')
  }

  const maxCalls = Number(await getConfigValue('call_masking_max_calls_per_ride', '10')) || 10
  const countKey = `callcount:ride:${params.rideId}`
  const count = await redis.incr(countKey)
  if (count === 1) await redis.expire(countKey, CALL_COUNT_TTL_SECONDS)
  if (count > maxCalls) {
    throw new CallMaskingError('CALL_LIMIT_REACHED', 'Max call attempts reached for this ride')
  }

  try {
    await ivr.makeCall({
      receiverNumber: params.callerRole === 'user' ? driverPhone : riderPhone,
      agentNumber: params.callerRole === 'user' ? riderPhone : driverPhone,
      dial: params.callerRole === 'user' ? 'Customer' : 'Agent',
    })
  } catch (err) {
    // A vendor failure isn't a connected call — give the attempt back so an
    // outage can't exhaust the ride's cap.
    await redis.decr(countKey).catch(() => undefined)
    log.error({ err, rideId: params.rideId }, 'bulksmsplans makeACall failed')
    throw new CallMaskingError('CALL_FAILED', 'Could not connect the call — please try again')
  }
}

// Auto-disables masking once the IVR account's live credit balance runs low.
// bulksmsplans has no push-based spend webhook (unlike Exotel's
// StatusCallback), so this polls check_ivr_credit instead of tallying spend
// from call events. Same fire-and-forget kill-switch shape as the old
// Exotel daily-budget check: the UPDATE's WHERE clause only matches while
// the switch is still on, so a later tick (already off) updates 0 rows and
// skips the notify.
export async function checkCreditBalance(): Promise<void> {
  const floor = Number(await getConfigValue('call_masking_credit_floor', '500'))
  if (!Number.isFinite(floor)) {
    log.error('call_masking_credit_floor is not numeric — skipping credit check')
    return
  }
  let credit: number
  try {
    credit = await ivr.checkCredit()
  } catch (err) {
    log.error({ err }, 'failed to check IVR credit balance')
    return
  }
  if (credit >= floor) return

  const { rowCount } = await pool.query(
    `UPDATE system_config SET value = 'false', updated_at = now()
     WHERE key = 'call_masking_enabled' AND value = 'true'`
  )
  if (!rowCount) return

  await invalidate(configKey('call_masking_enabled'))

  await notifyAllAdmins({
    type: 'call_masking_credit_low',
    title: 'Masked calling auto-disabled',
    body: `IVR credit balance (${credit}) dropped below the ${floor} floor — masking has been switched off. Top up the bulksmsplans account and re-enable call_masking_enabled once reviewed.`,
  })
}
