import { client as redis } from '@/db/redis'
import { withTimeout } from '@/lib/with-timeout'
import { getConfigValue } from '@/lib/system-config'
import { logger } from '@/lib/logger'
import { etaShadowLegKey, activeRideByUserKey } from '@/constants/redis-keys'
import {
  ETA_SHADOW_LEG_TTL_SECONDS, ETA_SHADOW_SAMPLE_MS, ETA_SHADOW_GOOGLE_SAMPLE_MS, ETA_SHADOW_DEST_MATCH_M, ACTIVE_RIDE_USER_CACHE_SEC,
} from '@/constants/limits'
import {
  decodePolyline, buildRoute, projectOnRoute, etaFromProgress, haversineM, FRESH_ETA_STATE,
  type BuiltRoute, type EtaState,
} from '@/lib/route-progress'
import * as repo from './rides.repository'

// Shadow ETA (docs/superpowers/plans/2026-11-10-google-maps-cost.md, phase B). While the switch is on it keeps a ride leg's route in Redis,
// samples the ETA that route and the driver's progress would give, and logs it next to the ETA Google gave the rider. It changes nothing
// a rider or driver sees and makes no Google request of its own (the route is the one the ETA snapshot already fetches). Every entry point
// is best effort: it catches its own errors, so it can never fail a ride transition, a location ping or a route request.
const log = logger.child({ module: 'eta-shadow' })

type Leg = 'to_pickup' | 'to_destination'
type StoredLeg = { leg: Leg; polyline: string; baselineSec: number; destLat: number; destLng: number; storedAt: number }
type LegState = { storedAt: number; leg: Leg; route: BuiltRoute; baselineSec: number; dest: [number, number]; eta: EtaState }

// ── the switch, remembered in this process for 30 s so a ping does not pay a Redis read for it ──
const SWITCH_MEMO_MS = 30_000
let switchMemo: { value: boolean; at: number } | null = null
export async function shadowEnabled(now = Date.now()): Promise<boolean> {
  if (switchMemo && now - switchMemo.at < SWITCH_MEMO_MS) return switchMemo.value
  let value = false
  try { value = (await getConfigValue('eta_shadow_enabled', 'false')) === 'true' } catch { value = false }
  switchMemo = { value, at: now }
  return value
}
/** Test hook: forget the remembered switch value. */
export function resetShadowMemo(): void { switchMemo = null; states.clear(); lastOursAt.clear(); lastGoogleAt.clear() }

// ── per-process memory: the decoded route and the speed state of each ride, and when each ride was last sampled ──
const MAX_TRACKED = 5_000
const states = new Map<string, LegState>()
const lastOursAt = new Map<string, number>()
const lastGoogleAt = new Map<string, number>()
function remember<T>(map: Map<string, T>, key: string, value: T): void {
  map.set(key, value)
  if (map.size > MAX_TRACKED) { const oldest = map.keys().next().value; if (oldest !== undefined) map.delete(oldest) }
}

async function readLeg(rideId: string): Promise<StoredLeg | null> {
  const raw = await withTimeout(redis.get(etaShadowLegKey(rideId))).catch(() => null)
  if (!raw) return null
  try { return JSON.parse(raw) as StoredLeg } catch { return null }
}

// Decoding a few thousand points is cheap, but a ride is sampled every 30 s for an hour: reuse the decoded route while the stored one is unchanged.
function stateFor(rideId: string, stored: StoredLeg): LegState | null {
  const have = states.get(rideId)
  if (have && have.storedAt === stored.storedAt) return have
  const route = buildRoute(decodePolyline(stored.polyline))
  if (route.points.length < 2 || !(route.totalM > 0)) return null
  const fresh: LegState = { storedAt: stored.storedAt, leg: stored.leg, route, baselineSec: stored.baselineSec, dest: [stored.destLat, stored.destLng], eta: FRESH_ETA_STATE }
  remember(states, rideId, fresh)
  return fresh
}

/**
 * Keeps the route of a ride leg for the comparison. Called with the route the ETA snapshot has just fetched: `leg` replaces any earlier
 * leg of the same ride (the pickup leg is replaced by the trip leg at start). A route that did not come from Google, or has no usable
 * duration or line, is not kept.
 */
export async function storeShadowLeg(
  rideId: string, leg: Leg, route: { polyline?: string; source?: string; durationSec?: number; trafficDurationSec?: number },
  dest: { lat: number; lng: number },
): Promise<void> {
  try {
    if (!(await shadowEnabled())) return
    const baselineSec = route.trafficDurationSec ?? route.durationSec ?? 0
    if (route.source !== 'google' || !route.polyline || !(baselineSec > 0)) return
    const stored: StoredLeg = { leg, polyline: route.polyline, baselineSec, destLat: dest.lat, destLng: dest.lng, storedAt: Date.now() }
    await withTimeout(redis.set(etaShadowLegKey(rideId), JSON.stringify(stored), 'EX', ETA_SHADOW_LEG_TTL_SECONDS))
    states.delete(rideId)
    lastOursAt.delete(rideId)
  } catch (err) {
    log.warn({ err, rideId }, 'shadow ETA: could not store the leg')
  }
}

/** One driver ping on an active ride. Samples at most every ETA_SHADOW_SAMPLE_MS. */
export async function recordShadowPing(rideId: string, lat: number, lng: number, nowMs = Date.now()): Promise<void> {
  try {
    if (!(await shadowEnabled(nowMs))) return
    if (nowMs - (lastOursAt.get(rideId) ?? -Infinity) < ETA_SHADOW_SAMPLE_MS) return
    remember(lastOursAt, rideId, nowMs) // claimed before any await, so two quick pings cannot both sample
    const stored = await readLeg(rideId)
    if (!stored) return
    const state = stateFor(rideId, stored)
    if (!state) return
    const dtS = state.eta.prevAtMs === null ? 0 : (nowMs - state.eta.prevAtMs) / 1000
    // A vehicle cannot plausibly travel more than ~40 m/s: that bounds how far ahead of the last progress a position may be matched first.
    const progress = projectOnRoute(state.route, lat, lng, state.eta.prevAlongM ?? 0, Math.max(3_000, 40 * dtS))
    if (!progress) return
    const eta = etaFromProgress({ totalM: state.route.totalM, baselineSec: state.baselineSec, alongM: progress.alongM, nowMs, state: state.eta })
    if (!eta) return
    // An off-route position says nothing about progress: the sample is logged (with its distance) but the speed state is not advanced by it.
    if (!progress.offRoute) state.eta = eta.state
    await repo.insertEtaShadow({
      rideId: BigInt(rideId), leg: state.leg, kind: 'ours', etaSec: eta.etaBlendSec, etaBaseSec: eta.etaBaseSec,
      remainingM: eta.remainingM, offRouteM: progress.distM,
    })
  } catch (err) {
    log.warn({ err, rideId }, 'shadow ETA: ping sample failed')
  }
}

async function activeRideIdForUser(userId: bigint): Promise<string | null> {
  const key = activeRideByUserKey(userId.toString())
  const cached = await withTimeout(redis.get(key)).catch(() => null)
  if (cached !== null) return cached === '' ? null : cached
  const id = await repo.getActiveRideIdForUser(userId)
  await withTimeout(redis.set(key, id ?? '', 'EX', ACTIVE_RIDE_USER_CACHE_SEC)).catch(() => undefined)
  return id
}

/**
 * A rider's traffic-aware route request has just been answered by Google (or the cache): log what the rider was shown, if it is for the
 * stored leg of their active ride. `result` is the response already sent; this never changes it.
 */
export async function recordShadowGoogle(
  userId: bigint, dest: { lat: number; lng: number },
  result: { distanceKm: number; durationMin: number; trafficDurationMin?: number; trafficDurationSec?: number; source?: string },
  nowMs = Date.now(),
): Promise<void> {
  try {
    if (!(await shadowEnabled(nowMs))) return
    if (result.source !== 'google') return
    const rideId = await activeRideIdForUser(userId)
    if (!rideId) return
    if (nowMs - (lastGoogleAt.get(rideId) ?? -Infinity) < ETA_SHADOW_GOOGLE_SAMPLE_MS) return
    remember(lastGoogleAt, rideId, nowMs)
    const stored = await readLeg(rideId)
    if (!stored) return
    if (haversineM([dest.lat, dest.lng], [stored.destLat, stored.destLng]) > ETA_SHADOW_DEST_MATCH_M) return
    // What the rider's app shows is Google's live-traffic minutes; seconds are used when the response carries them.
    const etaSec = result.trafficDurationSec ?? (result.trafficDurationMin ?? result.durationMin) * 60
    await repo.insertEtaShadow({ rideId: BigInt(rideId), leg: stored.leg, kind: 'google', etaSec, remainingM: result.distanceKm * 1000 })
  } catch (err) {
    log.warn({ err }, 'shadow ETA: google sample failed')
  }
}
