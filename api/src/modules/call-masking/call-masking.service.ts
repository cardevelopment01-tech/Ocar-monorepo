import { config } from '@/config'
import { pool } from '@/db/client'
import { getConfigValue } from '@/lib/system-config'
import { invalidate } from '@/lib/cache/reference-cache'
import { configKey } from '@/constants/redis-keys'
import { getRideById } from '@/modules/rides/rides.repository'
import { createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as repo from '@/modules/call-masking/call-masking.repository'
import * as exotel from '@/modules/call-masking/call-masking.exotel-client'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { CallMaskingError, type CallerRole } from '@/modules/call-masking/call-masking.types'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('call-masking')

export async function allocateForRide(params: {
  rideId: bigint
  driverPhone: string
  riderPhone: string
}): Promise<void> {
  const enabled = await getConfigValue('exotel_masking_enabled', 'false')
  if (enabled !== 'true') return

  await repo.allocateNumber({
    rideId: params.rideId,
    driverPhone: params.driverPhone,
    riderPhone: params.riderPhone,
    ttlMinutes: 180, // covers longest realistic round-trip/rental ride; released early on completion/cancellation anyway
  })
  // A null return (pool exhausted) is intentionally swallowed here: the ride
  // proceeds without a masked-call option rather than failing the booking.
}

export async function releaseForRide(rideId: bigint): Promise<void> {
  await repo.releaseByRideId(rideId)
}

export async function triggerCall(params: {
  rideId: bigint
  callerRole: CallerRole
  callerId: bigint
}): Promise<{ sid: string }> {
  // Ride-participant check — mirrors ride-chat.service.ts's resolveParticipant:
  // the caller must actually be the rider or driver on this ride, otherwise
  // any authenticated user/driver could trigger a real, billed call between
  // two strangers.
  const ride = await getRideById(params.rideId)
  if (!ride) throw createHttpError(AppErrors.RIDE_NOT_FOUND)
  const isOwner =
    (params.callerRole === 'user' && String(ride.user_id) === String(params.callerId)) ||
    (params.callerRole === 'driver' && ride.driver_id !== null && String(ride.driver_id) === String(params.callerId))
  if (!isOwner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

  const enabled = await getConfigValue('exotel_masking_enabled', 'false')
  if (enabled !== 'true') {
    throw new CallMaskingError('MASKING_DISABLED', 'Masked calling is currently disabled')
  }

  const mask = await repo.getActiveMaskForRide(params.rideId)
  if (!mask) {
    throw new CallMaskingError('NO_ACTIVE_MASK', 'No active call mask for this ride')
  }
  if (mask.expiresAt.getTime() < Date.now()) {
    throw new CallMaskingError('MASK_EXPIRED', 'Call mask has expired')
  }

  const maxCalls = Number(await getConfigValue('exotel_max_calls_per_ride', '5'))
  if (mask.callCount >= maxCalls) {
    throw new CallMaskingError('CALL_LIMIT_REACHED', 'Max call attempts reached for this ride')
  }

  const timeLimitSeconds = Number(await getConfigValue('exotel_call_time_limit_seconds', '600'))
  const from = params.callerRole === 'user' ? mask.riderPhone : mask.driverPhone
  const to = params.callerRole === 'user' ? mask.driverPhone : mask.riderPhone

  const callParams: Parameters<typeof exotel.connectTwoNumbers>[0] = {
    from,
    to,
    callerId: mask.virtualNumber,
    timeLimitSeconds,
    customField: mask.id.toString(),
  }
  if (config.EXOTEL_WAIT_AUDIO_URL) callParams.waitAudioUrl = config.EXOTEL_WAIT_AUDIO_URL
  if (config.EXOTEL_STATUS_CALLBACK_URL) callParams.statusCallbackUrl = config.EXOTEL_STATUS_CALLBACK_URL

  const call = await exotel.connectTwoNumbers(callParams)

  await repo.incrementCallCount(mask.id)
  return { sid: call.sid }
}

// Safety-net sweep for masks that outlived their ride (see repo comment).
export async function sweepExpiredMasks(): Promise<void> {
  const released = await repo.releaseExpiredMasks()
  if (released > 0) log.info({ released }, 'released expired call masks')
}

// Auto-disables masking once today's Exotel spend crosses the budget. The
// UPDATE's WHERE clause only matches while the switch is still on, so a
// later tick (switch already off) updates 0 rows and skips the notify —
// this is what keeps admins from getting paged every 15 minutes all day.
export async function checkDailySpend(): Promise<void> {
  const spend = await repo.getTodaySpendInr()
  const budget = Number(await getConfigValue('exotel_daily_budget_inr', '500'))
  if (spend < budget) return

  const { rowCount } = await pool.query(
    `UPDATE system_config SET value = 'false', updated_at = now()
     WHERE key = 'exotel_masking_enabled' AND value = 'true'`
  )
  if (!rowCount) return

  await invalidate(configKey('exotel_masking_enabled'))

  await notifyAllAdmins({
    type: 'exotel_budget_exceeded',
    title: 'Masked calling auto-disabled',
    body: `Today's Exotel spend (₹${spend.toFixed(2)}) hit the ₹${budget} daily budget — masking has been switched off. Re-enable exotel_masking_enabled once reviewed.`,
  })
}
