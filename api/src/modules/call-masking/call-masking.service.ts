import { config } from '@/config'
import { getConfigValue } from '@/lib/system-config'
import * as repo from '@/modules/call-masking/call-masking.repository'
import * as exotel from '@/modules/call-masking/call-masking.exotel-client'
import { CallMaskingError, type CallerRole } from '@/modules/call-masking/call-masking.types'

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
}): Promise<{ sid: string }> {
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
