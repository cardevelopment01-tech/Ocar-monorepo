// Decides whether a just-completed ride should send the driver back to the selfie + plate check, and records the
// challenge. It never touches the driver's session or sends anything: the caller (rides.service) takes the driver
// offline and notifies, so this module has no dependency on the rides module. Design doc section 9.5.
import { randomInt } from 'crypto'
import { getConfigValue } from '@/lib/system-config'
import { getVerificationContext } from './driver-verification.repository'
import * as repo from './driver-verification.repository'
import { resolveMode } from './driver-verification.service'

export interface SpotCheckConfig { ridesMin: number; ridesMax: number; longRideKm: number; longRideMinutes: number }

export type SpotCheckReason = 'rides' | 'long_ride'

// Pure: given the config, the ride and the count since the last verified check, which reason (if any) applies?
// A long one-way or round-trip always triggers; otherwise the random "after N rides" counter does.
export function decideSpotCheck(args: {
  cfg: SpotCheckConfig
  ride: repo.CompletedRideFacts
  ridesSinceVerified: number
  target: number
}): SpotCheckReason | null {
  const { cfg, ride } = args
  const longKind = ride.rideType === 'one_way' || ride.rideType === 'round_trip'
  if (longKind) {
    if (ride.distanceKm != null && ride.distanceKm >= cfg.longRideKm) return 'long_ride'
    if (ride.durationMin != null && ride.durationMin >= cfg.longRideMinutes) return 'long_ride'
  }
  return args.ridesSinceVerified >= args.target ? 'rides' : null
}

function int(v: string, fallback: number): number {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export async function loadSpotCheckConfig(): Promise<SpotCheckConfig> {
  const [min, max, km, minutes] = await Promise.all([
    getConfigValue('spot_check_rides_min', '2'),
    getConfigValue('spot_check_rides_max', '3'),
    getConfigValue('spot_check_long_ride_km', '60'),
    getConfigValue('spot_check_long_ride_minutes', '90'),
  ])
  const ridesMin = int(min, 2)
  return {
    ridesMin,
    ridesMax: Math.max(ridesMin, int(max, 3)), // a max below the min would make the draw meaningless
    longRideKm: Number(km) > 0 ? Number(km) : 60,
    longRideMinutes: int(minutes, 90),
  }
}

const drawTarget = (cfg: SpotCheckConfig) => randomInt(cfg.ridesMin, cfg.ridesMax + 1)

/** Returns the new challenge id when the driver must re-verify, else null. Safe to call for any completed ride. */
export async function maybeOpenSpotCheck(driverId: bigint, rideId: bigint): Promise<string | null> {
  const ctx = await getVerificationContext(driverId)
  if ((await resolveMode(ctx.modeOverride)) === 'off') return null
  if ((await getConfigValue('spot_check_enabled', 'false')) !== 'true') return null
  if (await repo.getOpenChallenge(driverId)) return null
  // Never take a driver offline with another passenger already accepted or on the way.
  if (await repo.hasOtherActiveRide(driverId, rideId)) return null

  const ride = await repo.getCompletedRideFacts(rideId)
  if (!ride) return null

  const cfg = await loadSpotCheckConfig()
  const since = await repo.lastVerifiedAt(driverId)
  const [ridesSinceVerified, target] = await Promise.all([
    repo.countCompletedRidesSince(driverId, since),
    repo.getOrDrawRidesTarget(driverId, () => drawTarget(cfg)),
  ])

  const reason = decideSpotCheck({ cfg, ride, ridesSinceVerified, target })
  if (!reason) return null

  const challengeId = await repo.insertChallengeIfNoneOpen(driverId, reason, {
    rideId: rideId.toString(), ridesSinceVerified, target, distanceKm: ride.distanceKm, durationMin: ride.durationMin,
  })
  if (!challengeId) return null // a concurrent completion opened it first
  await repo.redrawRidesTarget(driverId, drawTarget(cfg)) // the next target, for after this check
  return challengeId
}
