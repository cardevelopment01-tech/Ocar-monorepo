import crypto from 'crypto'
import { config } from '@/config'
import { client as redis } from '@/db/redis'
import { httpError } from '@/lib/errors'
import { sha256 } from '@/lib/hash'
import { logger } from '@/lib/logger'
import { getConfigValue } from '@/lib/system-config'
import { getRoute } from '@/modules/geo/geo.service'
import * as contacts from '@/modules/emergency-contacts/emergency-contacts.repository'
import * as notifService from '@/modules/notifications/notifications.service'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { dltVariable } from './share-sms'
import { sendSms } from '@/providers/sms.provider'
import { isShareExpired, phaseForStatus, SHAREABLE_STATUSES, toPublicTrip, type PublicTripDto, type TripEta } from './public-trip'
import * as repo from './ride-shares.repository'

const log = logger.child({ module: 'ride-shares' })

/** Caps from the plan: 10 active links per ride, 20 created per rider per hour. */
export const SHARE_CAPS = { perRide: 10, perHour: 20 } as const
/** The trip for all viewers of a ride is built at most this often; the ETA route at most this often (a minute per ride). */
const TRIP_CACHE_SECONDS = 2
const ETA_CACHE_SECONDS = 60

export const tripShareEnabled = async (): Promise<boolean> => (await getConfigValue('trip_share_enabled', 'false')) === 'true'

// 128 random bits as base64url (22 characters). Only the SHA-256 of it is stored.
const newToken = (): string => crypto.randomBytes(16).toString('base64url')
const urlFor = (token: string): string => `${config.USER_APP_URL}/t/${token}`

export interface CreatedShare {
  id: string
  url: string
  label: string | null
  /** Only for a contact share: whether the SMS went out. A failed SMS never fails the share; the rider can send the link another way. */
  sms?: 'sent' | 'failed'
}

async function requireOwnShareableRide(userId: bigint, rideId: bigint) {
  const ride = await repo.getRideForShare(rideId)
  if (!ride || ride.user_id !== userId.toString()) throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  if (!SHAREABLE_STATUSES.has(ride.status)) throw httpError(409, 'A trip can be shared once a driver is assigned and until it ends', 'RIDE_NOT_SHAREABLE')
  return ride
}

async function textContact(userId: bigint, riderName: string | null, phone: string, token: string): Promise<'sent' | 'failed'> {
  // Everything here, including the notification log, stays inside the try: the share rows are already committed and the URL exists
  // only in this response, so one contact's database or SMS error must never reject the whole create and lose every link.
  let logId: Awaited<ReturnType<typeof notifService.logNotification>> | undefined
  try {
    logId = await notifService.logNotification({ jobName: 'trip_share', recipientPhone: phone, payload: { userId: userId.toString() } })
    const { body } = await renderTemplate('trip_share', 'sms', { riderName: dltVariable(riderName ?? 'Your contact'), trackToken: token })
    await sendSms(phone, body)
    await notifService.markSent(logId)
    return 'sent'
  } catch (err) {
    log.warn({ err }, 'trip share SMS not sent')
    if (logId !== undefined) {
      try { await notifService.markFailed(logId, err instanceof Error ? err.message : String(err)) } catch { /* the log row is best effort */ }
    }
    return 'failed'
  }
}

/**
 * Creates the rider's links: one anonymous link (for the phone's share sheet) when no contacts are named, else one per saved
 * emergency contact, each texted. The URL is returned only here; the server keeps just the hash.
 */
export async function createShares(userId: bigint, rideId: bigint, rawContactIds: string[] = []): Promise<CreatedShare[]> {
  const contactIds = [...new Set(rawContactIds)] // the same contact named twice would be texted twice and burn the caps
  if (!(await tripShareEnabled())) throw httpError(403, 'Trip sharing is not available yet', 'TRIP_SHARE_DISABLED')
  await requireOwnShareableRide(userId, rideId)

  const saved = contactIds.length > 0 ? await contacts.list(userId) : []
  const chosen = contactIds.map((id) => saved.find((c) => c.id === id))
  if (chosen.some((c) => c === undefined)) throw httpError(422, 'One of the contacts is not yours', 'VALIDATION_ERROR')

  const targets: Array<{ label: string | null; phone: string | null }> =
    chosen.length > 0 ? chosen.map((c) => ({ label: c!.name, phone: c!.phone })) : [{ label: null, phone: null }]

  const tokens = targets.map(() => newToken())
  const res = await repo.insertShares(
    targets.map((t, i) => ({ rideId, userId, tokenHash: sha256(tokens[i]!), label: t.label, phone: t.phone, isSos: false })),
    SHARE_CAPS,
  )
  if (res.result !== 'created') {
    throw httpError(429, res.result === 'limit_ride' ? 'This trip already has the most links allowed. Stop one first' : 'Too many links created. Try again later', 'TRIP_SHARE_LIMIT')
  }

  // The texts go out together, not one after another: a slow SMS vendor must not make the rider wait for the sum of them all.
  const riderName = targets.some((t) => t.phone) ? await repo.getRiderFirstName(userId) : null
  return Promise.all(
    targets.map(async (t, i): Promise<CreatedShare> => {
      const url = urlFor(tokens[i]!)
      const item: CreatedShare = { id: res.ids[i]!, url, label: t.label }
      if (t.phone) item.sms = await textContact(userId, riderName, t.phone, tokens[i]!)
      return item
    }),
  )
}

/**
 * The link an SOS press puts in each contact's text. Never refused by the caps, never throws into the SOS flow: the caller falls
 * back to the old static-pin SMS on null (flag off, ride gone, any error).
 */
export async function createSosShare(rideId: bigint, userId: bigint): Promise<string | null> {
  try {
    if (!(await tripShareEnabled())) return null
    const ride = await repo.getRideForShare(rideId)
    if (!ride || ride.user_id !== userId.toString()) return null
    // A link nobody is texted is a publicly readable live location for up to 7 days and nothing else: the live SMS template ships
    // inactive until its DLT approval, so check that it can render before creating the link.
    try { await renderTemplate('sos_contact_live', 'sms', { riderName: 'Rider', trackToken: 'x' }) } catch { return null }
    // The first press already texted a live link; a second one (or a retried job) falls back to the static pin instead of stacking links.
    if (await repo.hasRecentSosShare(rideId)) return null
    const token = newToken()
    const res = await repo.insertShare({ rideId, userId, tokenHash: sha256(token), label: 'SOS', phone: null, isSos: true })
    return res.result === 'created' ? urlFor(token) : null
  } catch (err) {
    log.error({ err }, 'could not create the SOS live link')
    return null
  }
}

export async function listShares(userId: bigint, rideId: bigint) {
  const ride = await repo.getRideForShare(rideId)
  if (!ride || ride.user_id !== userId.toString()) throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  return repo.listActive(rideId, userId)
}

export async function stopShare(userId: bigint, rideId: bigint, shareId: bigint): Promise<void> {
  if (!(await repo.revokeOne(rideId, userId, shareId))) throw httpError(404, 'Link not found', 'NOT_FOUND')
}

export const stopAllShares = (userId: bigint, rideId: bigint) => repo.revokeAll(rideId, userId)

// ---- Public side ------------------------------------------------------------------------------------------------------

export type PublicTripResult = { kind: 'ok'; trip: PublicTripDto & { isSos: boolean } } | { kind: 'missing' } | { kind: 'expired' }

/** Cached in place of an ETA when routing failed or only had a straight-line guess. */
const NO_ETA = 'none'

/** An ETA as it was routed, with the moment it was worked out. */
interface CachedEta extends TripEta { at: number }

/**
 * A cached ETA is up to a minute old. Counting it down by the minutes that have passed keeps "arriving at" (which the page works out as
 * serverTime + etaMin) steady instead of sliding later with every poll.
 */
function agedEta(eta: CachedEta, now: Date): TripEta {
  const elapsedMin = (now.getTime() - eta.at) / 60_000
  return { etaMin: Math.max(1, Math.round(eta.etaMin - elapsedMin)), route: eta.route }
}

/** The ETA and planned route for a ride: one routed call per ride per minute, whoever is watching. Cached on the ride, not on coordinates. */
async function etaFor(rideId: bigint, row: Awaited<ReturnType<typeof repo.getPublicTripRow>>, now: Date): Promise<TripEta | null> {
  if (!row || row.driver_lat == null || row.driver_lng == null) return null
  const phase = phaseForStatus(row.status)
  if (phase !== 'driver_on_way' && phase !== 'in_trip') return null
  const key = `share:eta:${rideId}:${phase}`
  try {
    const cached = await redis.get(key)
    if (cached === NO_ETA) return null
    if (cached) return agedEta(JSON.parse(cached) as CachedEta, now)
  } catch { /* a cache miss is fine */ }
  const to = phase === 'driver_on_way' ? { lat: row.origin_lat, lng: row.origin_lng } : row.destination_lat != null && row.destination_lng != null ? { lat: row.destination_lat, lng: row.destination_lng } : null
  if (!to) return null
  try {
    const route = await getRoute(row.driver_lat, row.driver_lng, to.lat, to.lng)
    if (route.source === 'fallback') { await redis.set(key, NO_ETA, 'EX', ETA_CACHE_SECONDS).catch(() => undefined); return null }
    const eta: CachedEta = { etaMin: Math.max(1, Math.round(route.trafficDurationMin ?? route.durationMin)), route: route.polyline, at: now.getTime() }
    await redis.set(key, JSON.stringify(eta), 'EX', ETA_CACHE_SECONDS).catch(() => undefined)
    return agedEta(eta, now)
  } catch (err) {
    log.warn({ err, rideId: String(rideId) }, 'public trip ETA unavailable')
    await redis.set(key, NO_ETA, 'EX', ETA_CACHE_SECONDS).catch(() => undefined)
    return null
  }
}

async function buildTrip(rideId: bigint, now: Date): Promise<PublicTripDto | null> {
  const key = `share:trip:${rideId}`
  try {
    const cached = await redis.get(key)
    if (cached) return JSON.parse(cached) as PublicTripDto
  } catch { /* fall through to the database */ }
  const [row, stops] = await Promise.all([repo.getPublicTripRow(rideId), repo.getPublicStops(rideId)])
  if (!row) return null
  const trip = toPublicTrip(row, stops, await etaFor(rideId, row, now), now)
  await redis.set(key, JSON.stringify(trip), 'EX', TRIP_CACHE_SECONDS).catch(() => undefined)
  return trip
}

/**
 * Resolves a link to what the page shows. The token lookup is NOT cached, so a revoke takes effect on the next poll even
 * while the trip itself is served from the 2-second per-ride cache.
 */
export async function getPublicTrip(token: string, opts: { now?: Date; countView?: boolean } = {}): Promise<PublicTripResult> {
  const now = opts.now ?? new Date()
  const share = await repo.findByTokenHash(sha256(token))
  if (!share || share.revoked_at) return { kind: 'missing' }
  if (isShareExpired({ ...share, created_at: new Date(share.created_at) }, now)) return { kind: 'expired' }
  const trip = await buildTrip(BigInt(share.ride_id), now)
  if (!trip) return { kind: 'missing' }
  // Link-preview bots (WhatsApp, Telegram...) open the link when it is pasted; they must not look like a relative viewing it.
  if (opts.countView !== false) void repo.recordView(share.id).catch(() => undefined)
  return { kind: 'ok', trip: { ...trip, isSos: share.is_sos } }
}
