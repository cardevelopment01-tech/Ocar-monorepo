import { socketEvents, hasLiveDriverSocket } from '@/websocket/socket.server'
import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { releaseForRide } from '@/modules/offers/settlement'
import { driverFare } from '@/modules/offers/driver-fare'
import { BROADCAST_WINDOW_SECONDS, BROADCAST_MAX_DRIVERS, BROADCAST_MAX_LIVE_OFFERS, HEAD_START_COUNT, HEAD_START_MS, BACKGROUND_ACCEPT_WINDOW_SECONDS, BACKGROUND_ACCEPT_WINDOW_PHASE1_SECONDS, BROADCAST_ROUND_MAX, BROADCAST_ROUND_STEP_METRES, maxPickupRadiusMetres } from '@/constants/limits'
import { fastRoundSteps } from './ladder'
import { fastRoundsEnabled, decisionLogEnabled, recordRound } from './dispatch-metrics'
import { rideAckKey } from '@/constants/redis-keys'
import { client as redis } from '@/db/redis'
import { queues, QUEUE_NAMES } from '@/jobs/queues'
import { getMinWalletBalance } from '@/modules/payments/payments.service'
import { sendRideRequestPushOnce, notifyRideEvent, type RideRequestPushDetails } from '@/modules/notifications/notifications.service'
import type { AckCheckJobData } from './ack-check.processor'
import { logger } from '@/lib/logger'
import { getRoute } from '@/modules/geo/geo.service'

const log = logger.child({ module: 'broadcast-processor' })

const MAX_DRIVERS = BROADCAST_MAX_DRIVERS
/** Socket-ack wait before the fallback push: the original 4 s, or 2 s for a dispatch-phase-1 ride. */
const ACK_CHECK_DELAY_MS = 4_000
const ACK_CHECK_DELAY_PHASE1_MS = 2_000

/** The offer must not wait on Google: past this the straight-line figure is shown instead. */
const ROAD_DISTANCE_TIMEOUT_MS = 2_000

/**
 * The distance a driver sees on the offer is how far they would DRIVE to the pickup, the same figure their navigation shows after
 * they accept. Finding drivers still uses the straight-line distance (fast, indexed); only the shown number is routed, one cached
 * Routes call per offered driver (at most BROADCAST_MAX_DRIVERS per round). A slow or failed route keeps the straight-line number.
 */
async function withRoadDistance<T extends { lat: number; lng: number; distance_metres: number }>(drivers: T[], toLat: number, toLng: number): Promise<T[]> {
  return Promise.all(drivers.map(async (d) => {
    try {
      const route = await Promise.race([
        getRoute(d.lat, d.lng, toLat, toLng, { caller: 'dispatch' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ROAD_DISTANCE_TIMEOUT_MS)),
      ])
      if (!route || route.source === 'fallback' || !(route.distanceKm > 0)) return d
      return { ...d, distance_metres: Math.max(d.distance_metres, Math.round(route.distanceKm * 1000)) }
    } catch {
      return d
    }
  }))
}

export interface BroadcastJobData {
  rideId: string
  categoryId: string
  originLat: number
  originLng: number
  rideType: string
  isReturnCab: boolean
  destinationLat?: number
  destinationLng?: number
  broadcastRound: number
  radiusMetres?: number
  returnAt?: string
  tripHours?: number
}

export async function processBroadcast(data: BroadcastJobData): Promise<void> {
  const rideId     = BigInt(data.rideId)
  const categoryId = BigInt(data.categoryId)

  const ride = await repo.getRideById(rideId)
  if (!ride || ride.status !== 'requested') {
    log.info({ rideId: data.rideId }, 'broadcast skipped: ride no longer active')
    return
  }

  await repo.expireLapsedOffers(rideId)

  // Dispatch phase 1 (stamped on the ride at booking, so a switch flip never changes a ride in flight). Rides booked before it keep
  // dispatch_variant 0 and every line below behaves exactly as it always did.
  const phase1 = (ride.dispatch_variant ?? 0) >= 1
  const liveDriverIds = phase1 ? await repo.getLiveOfferDriverIds(rideId) : []
  // Rounds 1-2 also skip drivers who declined this ride (a decline now moves the ride on at once, so the same driver must not be handed it
  // straight back); the last round may return to them, since by then a declined driver is better than none.
  const declinedDriverIds = phase1 && data.broadcastRound < 3 ? await repo.getDeclinedDriverIds(rideId) : []
  // Dispatch spread (5a, per-city, stamped on the ride): remember every driver this ride already offered, and prefer drivers who hold no
  // live offer on another ride. Both are soft: if that leaves nobody, the ladder below relaxes them, so spreading never costs a ride.
  const spread = phase1 && (ride.dispatch_spread ?? 0) >= 1
  const [offeredBefore, busyDriverIds] = spread
    ? await Promise.all([repo.getOfferedDrivers(rideId), repo.getBusyDriverIds(rideId)])
    : [[], []] as [Awaited<ReturnType<typeof repo.getOfferedDrivers>>, bigint[]]
  const skipDriverIds = spread
    ? [...new Set([...liveDriverIds, ...offeredBefore.map((o) => o.driver_id), ...busyDriverIds].map((id) => id.toString()))].map((id) => BigInt(id))
    : [...liveDriverIds, ...declinedDriverIds]
  const liveSet = new Set(skipDriverIds.map((id) => id.toString()))
  // Return-cab matches are rare and route-specific, so a spread ride only keeps them away from drivers holding an open offer for this ride.
  const returnSkip = spread ? new Set(liveDriverIds.map((id) => id.toString())) : liveSet
  // Open offers this ride may have at once: backfilling around still-open offers must not grow the set across rounds.
  const maxThisRound = phase1 ? Math.min(MAX_DRIVERS, Math.max(0, BROADCAST_MAX_LIVE_OFFERS - liveDriverIds.length)) : MAX_DRIVERS
  if (phase1 && liveDriverIds.length > 0) {
    log.info({ event: 'ride_offer_live_kept', rideId: data.rideId, round: data.broadcastRound, liveOffers: liveDriverIds.length, newOfferRoom: maxThisRound }, 'open offers left alone')
  }

  const stops = await repo.getRideStops(rideId)
  const minWalletBalance = await getMinWalletBalance()

  // Round 1 stays exact-category only, so native-tier drivers get first crack
  // at their own tier's fare. Rounds 2+ widen to fallback-tier drivers
  // (category_fallback_rules) once the ride has gone unaccepted past round 1.
  const categoryIds = data.broadcastRound === 1
    ? [categoryId]
    : await repo.getEligibleDriverCategoryIds(categoryId)
  const categoryName = await repo.getCategoryDisplayName(categoryId)

  let drivers: Array<{
    driver_id: bigint
    session_id: bigint
    lat: number
    lng: number
    distance_metres: number
    // A driver whose tab backgrounded recently (findNearbyDrivers' grace-window
    // relaxation) rather than one with a live socket — gets an immediate push
    // instead of waiting on the socket emit + ack-check fallback, and a longer
    // per-assignment response window. Always false for return-cab matches,
    // which don't select is_available (unaffected by this feature).
    isBackgrounded: boolean
    // Dispatch phase 0 record: the radius that found this driver (default: the round's own radius).
    radiusM?: number
  }> = []

  // A city ride's mode is read from its ride row (stamped at booking), not from the job: jobs already queued carry no such field.
  const tripMode: 'standard' | 'city' = ride.trip_mode === 'city' ? 'city' : 'standard'
  const slug = data.rideType === 'rental' || tripMode === 'city' ? await repo.getCategorySlug(categoryId) : null
  const cap = maxPickupRadiusMetres(data.rideType, slug, data.tripHours, data.broadcastRound, tripMode)
  const roundRadius = Math.min(cap, data.radiusMetres ?? cap)
  // Dispatch phase 0 (migration 135): what the round did, recorded at the end. Both helpers answer "off" on any failure.
  const logOn = phase1 && await decisionLogEnabled()
  let widestRadius = roundRadius
  let fastStep = 0
  let recordCategoryIds = categoryIds  // the widest category set this round searched, so the "why" does not blame the wrong rule

  if (data.isReturnCab && data.destinationLat != null && data.destinationLng != null) {
    const returnDrivers = await repo.findReturnCabDrivers({
      pickupLat: data.originLat,
      pickupLng: data.originLng,
      dropLat:   data.destinationLat,
      dropLng:   data.destinationLng,
      categoryIds,
      minWalletBalance,
    })
    // Unknown distance (null/undefined/NaN) fails the cap: it must never read as 0 m away.
    // A driver without a usable location can't be matched, and we don't substitute the pickup point.
    const returnCandidates = returnDrivers.filter(d => Number.isFinite(d.distance_metres) && d.distance_metres <= cap && !returnSkip.has(String(d.driver_id)))
    drivers = (phase1 ? returnCandidates.slice(0, maxThisRound) : returnCandidates).map(d => ({
      driver_id:        BigInt(d.driver_id),
      session_id:       BigInt(d.session_id),
      lat:              d.lat,
      lng:              d.lng,
      distance_metres:  d.distance_metres,
      isBackgrounded:   false,
    }))
  }

  // A return-cab ride is priced at the discounted return rate, which only a driver heading that way has agreed to. It is therefore
  // NEVER offered to a standard driver, however few return-cab drivers match: it ends as no_drivers and the rider books a standard cab.
  const standardAllowed = !data.isReturnCab

  if (standardAllowed && drivers.length < maxThisRound) {
    const radiusMetres = Math.min(cap, data.radiusMetres ?? cap)
    const nearbyParams: Parameters<typeof repo.findNearbyDrivers>[0] = {
      lat: data.originLat,
      lng: data.originLng,
      categoryIds,
      maxDrivers: maxThisRound - drivers.length,
      radiusMetres,
      minWalletBalance,
    }
    if (phase1 && skipDriverIds.length > 0) nearbyParams.excludeDriverIds = skipDriverIds
    const standardDrivers = await repo.findNearbyDrivers(nearbyParams)
    const included = new Set(drivers.map(d => d.driver_id.toString()))
    for (const sd of standardDrivers) {
      if (!included.has(sd.driver_id.toString()) && !liveSet.has(sd.driver_id.toString())) {
        drivers.push({
          driver_id:       BigInt(sd.driver_id),
          session_id:      BigInt(sd.session_id),
          lat:             sd.lat,
          lng:             sd.lng,
          distance_metres: sd.distance_metres,
          isBackgrounded:  sd.is_available === false,
        })
      }
    }
  }

  // Spread ladder, each step only when the one before found nobody (and only if there is room for a new offer): (2) allow drivers busy with
  // another ride, (3) also allow drivers offered before who did not decline, (4) everyone except open offers, decliners included. So the
  // rule can never leave a ride with fewer drivers than a non-spread ride would have had.
  let spreadLevel = 1
  if (standardAllowed && spread && !drivers.length && maxThisRound > 0) {
    const offeredIds = offeredBefore.map((o) => o.driver_id)
    const declined = offeredBefore.filter((o) => o.status === 'declined').map((o) => o.driver_id)
    const steps: bigint[][] = [[...liveDriverIds, ...offeredIds], [...liveDriverIds, ...declined], [...liveDriverIds]]
    for (const skip of steps) {
      spreadLevel++
      const found = await repo.findNearbyDrivers({
        lat: data.originLat, lng: data.originLng, categoryIds, maxDrivers: maxThisRound,
        radiusMetres: Math.min(cap, data.radiusMetres ?? cap), minWalletBalance,
        ...(skip.length > 0 ? { excludeDriverIds: skip } : {}),
      })
      for (const sd of found) {
        drivers.push({
          driver_id: BigInt(sd.driver_id), session_id: BigInt(sd.session_id), lat: sd.lat, lng: sd.lng,
          distance_metres: sd.distance_metres, isBackgrounded: sd.is_available === false,
        })
      }
      if (drivers.length) break
    }
  }
  if (spread) {
    log.info({ event: 'ride_offer_spread', rideId: data.rideId, round: data.broadcastRound, level: spreadLevel, alreadyOffered: offeredBefore.length, busySkipped: busyDriverIds.length, picked: drivers.length }, 'spread pick')
  }

  // A pool smaller than the wave: if skipping the drivers who declined left nobody, offer to them rather than burn the round.
  if (standardAllowed && phase1 && !spread && !drivers.length && declinedDriverIds.length > 0) {
    const retry: Parameters<typeof repo.findNearbyDrivers>[0] = {
      lat: data.originLat, lng: data.originLng, categoryIds, maxDrivers: maxThisRound,
      radiusMetres: Math.min(cap, data.radiusMetres ?? cap), minWalletBalance,
    }
    if (liveDriverIds.length > 0) retry.excludeDriverIds = liveDriverIds
    for (const sd of await repo.findNearbyDrivers(retry)) {
      if (!liveSet.has(sd.driver_id.toString()) || declinedDriverIds.some((d) => d === BigInt(sd.driver_id))) {
        drivers.push({
          driver_id: BigInt(sd.driver_id), session_id: BigInt(sd.session_id), lat: sd.lat, lng: sd.lng,
          distance_metres: sd.distance_metres, isBackgrounded: sd.is_available === false,
        })
      }
    }
  }

  // Dispatch fast rounds: a round that found nobody widens at once (more categories, then +1 km steps, never past round 3's radius)
  // instead of leaving the ride to wait for the next round's timer. Off unless the switch is on; never for return-cab matches or a job
  // that carries its own radius.
  if (!drivers.length && maxThisRound > 0 && phase1 && !data.isReturnCab && data.radiusMetres == null && await fastRoundsEnabled()) {
    const capMax = maxPickupRadiusMetres(data.rideType, slug, data.tripHours, BROADCAST_ROUND_MAX, tripMode)
    const steps = fastRoundSteps(data.broadcastRound, roundRadius, capMax, BROADCAST_ROUND_STEP_METRES)
    const fallbackIds = steps.some((s) => !s.exactOnly) && data.broadcastRound === 1 ? await repo.getEligibleDriverCategoryIds(categoryId) : categoryIds
    // Like the normal search, each step first leaves out everyone this ride should skip (open offers, decliners, spread's busy and
    // already-offered drivers), then falls back to leaving out only the open offers, so widening never costs a ride a driver that a
    // plain search would have offered.
    const skipLists = skipDriverIds.length > liveDriverIds.length ? [skipDriverIds, liveDriverIds] : [skipDriverIds]
    for (const [i, step] of steps.entries()) {
      if (!step.exactOnly) recordCategoryIds = fallbackIds
      let found: Awaited<ReturnType<typeof repo.findNearbyDrivers>> = []
      for (const skip of skipLists) {
        found = await repo.findNearbyDrivers({
          lat: data.originLat, lng: data.originLng, categoryIds: step.exactOnly ? [categoryId] : fallbackIds, maxDrivers: maxThisRound,
          radiusMetres: step.radiusMetres, minWalletBalance,
          ...(skip.length > 0 ? { excludeDriverIds: skip } : {}),
        })
        if (found.length) break
      }
      widestRadius = Math.max(widestRadius, step.radiusMetres)
      if (!found.length) continue
      for (const sd of found) {
        drivers.push({
          driver_id: BigInt(sd.driver_id), session_id: BigInt(sd.session_id), lat: sd.lat, lng: sd.lng,
          distance_metres: sd.distance_metres, isBackgrounded: sd.is_available === false, radiusM: step.radiusMetres,
        })
      }
      fastStep = i + 1
      log.info({ event: 'ride_offer_fast_round', rideId: data.rideId, round: data.broadcastRound, step: fastStep, radiusMetres: step.radiusMetres, exactOnly: step.exactOnly, picked: drivers.length }, 'empty round widened')
      break
    }
  }

  // What this round skipped, for the record (spread also skips busy drivers and those already offered).
  const skippedCounts = { liveSkipped: liveDriverIds.length, declinedSkipped: declinedDriverIds.length, otherSkipped: spread ? new Set([...busyDriverIds, ...offeredBefore.map((o) => o.driver_id)].map(String)).size : 0 }

  if (!drivers.length) {
    const emptyRound = {
      rideId, round: data.broadcastRound, radiusM: roundRadius, widestRadiusM: widestRadius, fastStep, categoryIds: recordCategoryIds,
      found: 0, offered: 0, ...skippedCounts, diagFor: { lat: data.originLat, lng: data.originLng },
    }
    // Recorded once: a round 3 that defers (below) runs again and records then; "closed" is recorded only once the close really happened.
    if (data.broadcastRound < 3) await recordRound({ ...emptyRound, outcome: 'empty' }, logOn)
    if (data.broadcastRound >= 3 && phase1 && liveDriverIds.length > 0) {
      // Dispatch phase 1: nobody new to offer, but earlier offers are still open and must be allowed to be answered. Look again shortly;
      // once they lapse (at most one window) this branch closes the ride as before.
      await queues[QUEUE_NAMES.DISPATCH].add('broadcast_ride', data, { delay: 5_000, attempts: 1, removeOnComplete: true, removeOnFail: true })
      log.info({ rideId: data.rideId, liveOffers: liveDriverIds.length }, 'last round: open offers still live, close check deferred')
      return
    }
    if (data.broadcastRound >= 3) {
      // CAS: a driver may have accepted between the status read at the top and now.
      const closed = await repo.updateRideStatusCAS(rideId, 'requested', 'no_drivers')
      if (!closed) return
      // Nothing was delivered: give the rider's offer back.
      // Best effort: the stale-reservation sweep gives it back if this fails, and the rider must still be told.
      await releaseForRide(pool, rideId, 'no drivers').catch((err: unknown) => log.error({ err, rideId: data.rideId }, 'offer release failed'))
      await repo.logStatusHistory({
        rideId,
        fromStatus: 'requested',
        toStatus:   'no_drivers',
        actor:      'system',
        note:       'No drivers available after 3 broadcast rounds',
      })
      // Tell the rider now — otherwise the app keeps showing "Finding your driver" until it is reopened.
      socketEvents.sendRideStatusUpdate(data.rideId, { status: 'no_drivers' })
      const closedRide = await repo.getRideCoreById(rideId)
      if (closedRide) void notifyRideEvent('ride_no_drivers', BigInt(closedRide.user_id), rideId)
      log.info({ rideId: data.rideId }, 'no drivers available after max broadcast rounds')
      await recordRound({ ...emptyRound, outcome: 'closed' }, logOn)
    }
    return
  }

  // Phase 0 record: the straight-line distance and the nearest-first rank, before the shown (road) distance replaces the former.
  const straightById = new Map(drivers.map((d, i) => [d.driver_id.toString(), { straightM: Math.round(d.distance_metres), rank: i + 1 }]))
  drivers = await withRoadDistance(drivers, data.originLat, data.originLng)
  let offeredCount = 0

  // Sends the offers for `list` now: windows start now, assignments, ack keys, socket cards and pushes. Called once for the whole
  // round, or twice when the head start splits it (nearest drivers first, the rest a moment later).
  const sendOffers = async (list: typeof drivers): Promise<void> => {
    // Per-driver window: a backgrounded match gets longer to notice a push, tap
    // it, and let the app reconnect than a live-socket driver gets to ack.
    // Dispatch phase 1: a driver whose app looks foregrounded but has no live connection is in the same position as a backgrounded one
    // (only the push can reach them), so they get the same longer window and an immediate push. Lookups run concurrently, capped at
    // 500 ms each; an unknown answer counts as connected.
    const offline = new Set<string>()
    if (phase1) {
      const toCheck = list.filter((d) => !d.isBackgrounded)
      const present = await Promise.all(toCheck.map((d) => hasLiveDriverSocket(d.driver_id.toString())))
      toCheck.forEach((d, i) => { if (!present[i]) offline.add(d.driver_id.toString()) })
    }
    const driversWithWindow = list.map(driver => {
      const backgroundWindow = phase1 ? BACKGROUND_ACCEPT_WINDOW_PHASE1_SECONDS : BACKGROUND_ACCEPT_WINDOW_SECONDS
      const windowSeconds = driver.isBackgrounded || offline.has(driver.driver_id.toString()) ? backgroundWindow : BROADCAST_WINDOW_SECONDS
      return { ...driver, windowSeconds, expiresAt: new Date(Date.now() + windowSeconds * 1000) }
    })

    // Create all assignments in parallel — sequential awaits here were the source of
    // stacking delay (driver N had to wait for N-1 DB round-trips before getting the socket).
    await Promise.all(driversWithWindow.map(driver => {
      const id = driver.driver_id.toString()
      const seen = straightById.get(id)
      return (async () => {
        const created = await repo.createRideAssignment({
          rideId,
          driverId:       driver.driver_id,
          sessionId:      driver.session_id,
          expiresAt:      driver.expiresAt,
          broadcastRound: data.broadcastRound,
          driverLat:      driver.lat,
          driverLng:      driver.lng,
          ...(logOn && seen ? { log: {
            straightM: seen.straightM, shownM: Math.round(driver.distance_metres), radiusM: Math.round(driver.radiusM ?? roundRadius), rank: seen.rank,
            reach: driver.isBackgrounded ? 'background' as const : offline.has(id) ? 'no_socket' as const : 'live' as const, fastStep,
          } } : {}),
        })
        offeredCount++ // counted once the assignment exists, not when it is attempted
        return created
      })()
    }))

    // Delivery tracking for the closed-app ride request work (docs/superpowers/plans/2026-11-05-driver-app-closed-ride-alert-overlay.md,
    // phase 0). Structured log lines, not columns: join them to ride_assignments outcomes by rideId + driverId in Loki or Athena.
    //   ride_offer         the offer was made; `backgrounded` is what the server believed about the app (it sets the accept window)
    //   ride_offer_acked   the live app confirmed receipt over the socket (app open, socket alive)
    //   ride_offer_pushed  the ride-request push was sent (no ack by then means only the notification could have reached the driver)
    for (const driver of driversWithWindow) {
      log.info({
        event: 'ride_offer', rideId: data.rideId, driverId: driver.driver_id.toString(),
        backgrounded: driver.isBackgrounded, windowSeconds: driver.windowSeconds, round: data.broadcastRound, phase1,
      }, 'ride offer created')
    }

    // Set ACK keys and queue retry jobs BEFORE emitting the socket.
    // If the key is set after the emit, a fast ACK from the driver deletes a
    // non-existent key (no-op), the key is then set, and the ack-check loop
    // re-fires indefinitely thinking the driver never received the notification.
    await Promise.all(driversWithWindow.map(async (driver) => {
      const driverIdStr = driver.driver_id.toString()
      await redis.set(rideAckKey(data.rideId, driverIdStr), '1', 'EX', driver.windowSeconds + 30)

      const jobData: AckCheckJobData = {
        rideId:           data.rideId,
        driverId:         driverIdStr,
        expiresAt:        driver.expiresAt.toISOString(),
        pickup:           ride.origin_address   ?? 'Pickup location',
        drop:             ride.destination_address ?? 'Destination',
        pickupLat:        data.originLat,
        pickupLng:        data.originLng,
        distanceToPickup: Math.round(driver.distance_metres),
        // What the driver earns: the payable, so a rider offer is visible before they accept (review decision D20).
        estimatedFare:    driverFare(ride),
        rideType:         data.rideType,
        isReturnCab:      data.isReturnCab,
        offerRound:       data.broadcastRound,
      }
      if (data.destinationLat !== undefined) jobData.destinationLat = data.destinationLat
      if (data.destinationLng !== undefined) jobData.destinationLng = data.destinationLng

      await queues[QUEUE_NAMES.DISPATCH].add(
        'broadcast_ride_ack_check',
        jobData,
        { delay: phase1 ? ACK_CHECK_DELAY_PHASE1_MS : ACK_CHECK_DELAY_MS, attempts: 1, removeOnComplete: true, removeOnFail: true }
      )
    }))

    const pickup = ride.origin_address ?? 'Pickup location'
    const drop   = ride.destination_address ?? 'Destination'

    const pushNow = (driver: (typeof driversWithWindow)[number]): void => {
      const details: RideRequestPushDetails = {
        rideType: data.rideType,
        isReturnCab: data.isReturnCab,
        // The same fare the request card shows (the payable when a rider offer lowered it), not the gross estimate.
        estimatedFare: driverFare(ride),
        distanceToPickup: Math.round(driver.distance_metres),
      }
      if (ride.payment_channel) details.paymentChannel = ride.payment_channel
      if (ride.estimated_km != null) details.tripKm = Number(ride.estimated_km)
      if (ride.estimated_min != null) details.tripMin = Math.round(Number(ride.estimated_min))
      void sendRideRequestPushOnce(data.rideId, driver.driver_id.toString(), pickup, drop, driver.windowSeconds, details)
        .catch((err: unknown) => log.error({ err, rideId: data.rideId, driverId: driver.driver_id.toString() }, 'immediate push failed'))
    }

    for (const driver of driversWithWindow) {
      const requestPayload: Record<string, unknown> = {
        rideId:            data.rideId,
        pickup,
        drop,
        pickupLat:         data.originLat,
        pickupLng:         data.originLng,
        destinationLat:    ride.dest_lat ?? undefined,
        destinationLng:    ride.dest_lng ?? undefined,
        distanceToPickup:  Math.round(driver.distance_metres),
        estimatedFare:     driverFare(ride),
        rideType:          data.rideType,
        isReturnCab:       data.isReturnCab,
        expiresAt:         driver.expiresAt.toISOString(),
        timeoutSeconds:    driver.windowSeconds,
        // Which offer this is for the ride (the broadcast round). Lets the driver app tell a genuine new offer from a re-send; old
        // builds ignore the field.
        offerRound:        data.broadcastRound,
        stopCount:         stops.length,
      }
      if (ride.return_at)   requestPayload['returnAt']  = ride.return_at
      if (ride.trip_hours)  requestPayload['tripHours'] = Number(ride.trip_hours)
      if (categoryName)     requestPayload['rideCategoryName'] = categoryName
      if (ride.payment_channel) requestPayload['paymentChannel'] = ride.payment_channel
      if (parseFloat(ride.discount_amount ?? '0') > 0) requestPayload['riderOffer'] = true
      if (ride.estimated_km != null) requestPayload['tripKm'] = Number(ride.estimated_km)
      if (ride.estimated_min != null) requestPayload['tripMin'] = Math.round(Number(ride.estimated_min))
      if (ride.rental_km_limit != null) requestPayload['kmLimit'] = Number(ride.rental_km_limit)
      socketEvents.sendRideRequest(driver.driver_id.toString(), requestPayload)

      // A backgrounded driver's socket is very likely dead — don't wait for
      // ack-check's 4s-later fallback, push immediately. Guarded internally so
      // ack-check's own fallback (if it still fires) is a no-op for this driver.
      if (driver.isBackgrounded || offline.has(driver.driver_id.toString())) pushNow(driver)
    }

  }

  // Dispatch experiment (dispatch_variant 2): in round 1 the nearest HEAD_START_COUNT drivers get the offer alone for HEAD_START_MS, so
  // a close driver's tap is not beaten by a far driver's. Everyone else follows unless the ride was taken or cancelled meanwhile.
  // If the worker dies in the gap the rest simply get it in round 2 (25 s later).
  const headStart = (ride.dispatch_variant ?? 0) >= 2 && data.broadcastRound === 1 && drivers.length > HEAD_START_COUNT
  try {
    if (!headStart) {
      await sendOffers(drivers)
    } else {
      await sendOffers(drivers.slice(0, HEAD_START_COUNT))
      await new Promise((r) => setTimeout(r, HEAD_START_MS))
      const still = await repo.getRideById(rideId)
      if (still?.status === 'requested') await sendOffers(drivers.slice(HEAD_START_COUNT))
      else log.info({ rideId: data.rideId }, 'head start: ride no longer open, rest not offered')
    }
  } finally {
    // Recorded even if sending failed part way, and `offered` counts only the offers actually created (a head start can stop after the first two).
    await recordRound({
      rideId, round: data.broadcastRound, radiusM: roundRadius, widestRadiusM: widestRadius, fastStep, categoryIds: recordCategoryIds,
      found: drivers.length, offered: offeredCount, ...skippedCounts, outcome: 'offered',
      ...(drivers.length < maxThisRound ? { diagFor: { lat: data.originLat, lng: data.originLng } } : {}),
    }, logOn)
  }

  log.info(
    { rideId: data.rideId, broadcastRound: data.broadcastRound, driverCount: drivers.length },
    'broadcast round sent'
  )
}
