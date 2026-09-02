import type { Express } from 'express'
import request from 'supertest'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'

async function login(app: Express, redis: Redis, phone: string, role: 'user' | 'driver') {
  // Real key format is `otp_rate:{role}:{phone}:{purpose}` (api/src/lib/otp.ts:37) —
  // NOT `otp_rate:{phone}:{purpose}` as m02.test.ts's own cleanup uses (a latent bug
  // there: its del() never matches the real key, found while verifying this plan's
  // baseline). Do not copy m02's version.
  await redis.del(`otp_rate:${role}:${phone}:login`)
  await redis.del(`otp:${role}:${phone}:login`)
  const otpRes = await request(app).post('/api/v1/auth/otp/request').send({ phone, role })
  if (otpRes.status !== 200) {
    throw new Error(`OTP request failed for ${phone}: ${JSON.stringify(otpRes.body)}`)
  }
  const { otp } = otpRes.body as { otp: string }
  const verifyRes = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, role })
  if (verifyRes.status < 200 || verifyRes.status >= 300) {
    throw new Error(`OTP verify failed for ${phone}: ${JSON.stringify(verifyRes.body)}`)
  }
  const { tokens, principal } = verifyRes.body as {
    tokens: { accessToken: string }
    principal: { id: string }
  }
  return { accessToken: tokens.accessToken, id: principal.id }
}

export async function loginUser(app: Express, redis: Redis, phone: string) {
  const { accessToken, id } = await login(app, redis, phone, 'user')
  return { accessToken, userId: id }
}

export async function loginDriver(app: Express, redis: Redis, phone: string) {
  const { accessToken, id } = await login(app, redis, phone, 'driver')
  return { accessToken, driverId: id }
}

/**
 * Seeds a driver straight to active-with-approved-vehicle via SQL, matching
 * the precedent in driver-verification.test.ts (TC-DV-001) — there is no
 * HTTP admin-approval endpoint to drive this through, status is recomputed
 * automatically by syncDriverStatusAfterDocChange once real docs are approved,
 * which is a separate, already-tested path (M03).
 */
export async function seedActiveDriverWithVehicle(
  pool: Pool,
  driverId: string,
  opts: {
    categorySlug?: string
    brandName?: string
    citySlug?: string
    plate?: string
    walletBalance?: number
  } = {}
) {
  const categorySlug = opts.categorySlug ?? 'sedan'
  const brandName = opts.brandName ?? 'Maruti Suzuki'
  const citySlug = opts.citySlug ?? 'bhubaneswar'
  // Derived from driverId (always unique) rather than Math.random() over a
  // ~9000-value pool, which was observed to collide on driver_vehicles'
  // UNIQUE(number_plate) constraint once enough tests had run.
  const plate = opts.plate ?? `OD02${driverId}`
  const walletBalance = opts.walletBalance ?? 10000

  const { rows: cats } = await pool.query<{ id: string }>(
    'SELECT id FROM vehicle_categories WHERE slug = $1', [categorySlug]
  )
  const categoryId = cats[0]!.id
  const { rows: brands } = await pool.query<{ id: string }>(
    'SELECT id FROM vehicle_brands WHERE name = $1', [brandName]
  )
  const brandId = brands[0]!.id
  const { rows: models } = await pool.query<{ id: string }>(
    'SELECT id FROM vehicle_models WHERE brand_id = $1 LIMIT 1', [brandId]
  )
  const modelId = models[0]!.id
  const { rows: cities } = await pool.query<{ id: string }>(
    'SELECT id FROM cities WHERE slug = $1', [citySlug]
  )
  const cityId = cities[0]!.id

  await pool.query(`UPDATE drivers SET status = 'active', city_id = $2 WHERE id = $1`, [driverId, cityId])

  const { rows: vehicles } = await pool.query<{ id: string }>(
    `INSERT INTO driver_vehicles (driver_id, category_id, brand_id, model_id, number_plate, status, is_primary)
     VALUES ($1, $2, $3, $4, $5, 'active', true) RETURNING id`,
    [driverId, categoryId, brandId, modelId, plate]
  )
  const vehicleId = vehicles[0]!.id

  await pool.query(
    `INSERT INTO driver_wallets (driver_id, balance) VALUES ($1, $2)
     ON CONFLICT (driver_id) DO UPDATE SET balance = $2`,
    [driverId, walletBalance]
  )

  return { vehicleId, categoryId: Number(categoryId), cityId: Number(cityId) }
}

/** Satisfies goOnline()'s 428 DAILY_CHECK_REQUIRED gate. Requires @/lib/storage mocked. */
export async function completeDailyVerification(app: Express, accessToken: string) {
  const selfieInit = await request(app)
    .post('/api/v1/drivers/daily-verification/upload-init')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ kind: 'selfie', content_type: 'image/jpeg', content_length: 1024 })
  if (selfieInit.status !== 200) {
    throw new Error(`Selfie upload-init failed: ${JSON.stringify(selfieInit.body)}`)
  }
  const plateInit = await request(app)
    .post('/api/v1/drivers/daily-verification/upload-init')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ kind: 'plate', content_type: 'image/jpeg', content_length: 1024 })
  if (plateInit.status !== 200) {
    throw new Error(`Plate upload-init failed: ${JSON.stringify(plateInit.body)}`)
  }
  const res = await request(app)
    .post('/api/v1/drivers/daily-verification')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ selfie_key: selfieInit.body.key, plate_key: plateInit.body.key })
  if (res.status !== 201) {
    throw new Error(`Daily verification failed: ${JSON.stringify(res.body)}`)
  }
}

export async function goOnline(
  app: Express, accessToken: string, vehicleId: string, categoryId: number,
  lat = 20.29, lng = 85.82
) {
  return request(app)
    .post('/api/v1/rides/sessions/online')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ mode: 'standard', vehicleId: Number(vehicleId), categoryId, lat, lng })
}

/** Full driver-ready-to-accept-rides setup, composing the helpers above. */
export async function setupOnlineDriver(
  app: Express, pool: Pool, redis: Redis, phone: string,
  opts: Parameters<typeof seedActiveDriverWithVehicle>[2] = {}
) {
  const { accessToken, driverId } = await loginDriver(app, redis, phone)
  const { vehicleId, categoryId, cityId } = await seedActiveDriverWithVehicle(pool, driverId, opts)
  await completeDailyVerification(app, accessToken)
  const onlineRes = await goOnline(app, accessToken, vehicleId, categoryId)
  if (onlineRes.status !== 200) {
    throw new Error(`Go-online failed: ${JSON.stringify(onlineRes.body)}`)
  }
  return { accessToken, driverId, vehicleId, categoryId, cityId, sessionId: onlineRes.body.id as string }
}

export const DEFAULT_BOOKING = {
  rideType: 'one_way' as const,
  originLat: 20.29,
  originLng: 85.82,
  originAddress: 'Test Origin, Bhubaneswar',
  destinationLat: 20.45,
  destinationLng: 85.88,
  destinationAddress: 'Test Destination, Bhubaneswar',
  distanceKm: 18,
  durationMin: 30,
  paymentChannel: 'cash' as const,
}

/**
 * settleRideCompletionPayment (rides.service.ts) runs fire-and-forget after
 * end-otp verification for wallet-channel rides — poll for the payment to
 * reach 'completed' rather than assuming it landed synchronously. Was
 * duplicated verbatim in m08.test.ts and m09.test.ts before being promoted
 * here; both now share this one copy.
 */
export async function waitForWalletPaymentCompleted(pool: Pool, rideId: string) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ id: string; status: string; amount: string }>(
      `SELECT id, status, amount FROM payments WHERE ride_id = $1 AND channel = 'platform_wallet'`, [rideId]
    )
    if (rows[0]?.status === 'completed') return rows[0]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out waiting for completed wallet payment for ride ${rideId}`)
}

/**
 * Drives an already-booked ride through broadcast -> accept -> arrived ->
 * start-otp -> end-otp. Shared by any test that only needs a `completed`
 * ride as *setup* for something else (e.g. asserting on the resulting
 * payment/wallet/webhook side effects) — not for tests whose actual point
 * is asserting on each intermediate status transition (see m07.test.ts's
 * "Full ride progression" test, which stays inline for that reason).
 *
 * Takes the driver offline as its last step: findNearbyDrivers
 * (broadcast.processor.ts) caps a broadcast round at BROADCAST_MAX_DRIVERS
 * (5, constants/limits.ts), and every driver this fixture logs online would
 * otherwise stay 'online' forever with no ride, silently eating a broadcast
 * slot from every later test's driver that shares the same lat/lng.
 */
// Drives a booked ride through accept -> arrived -> start-otp, stopping at
// `in_progress`. Shared by driveRideToCompletion below and by any test that
// needs an active ride without finishing it (e.g. SOS, which can only be
// triggered on an active ride).
export async function driveRideToInProgress(
  app: Express,
  rideId: string,
  driver: { accessToken: string; categoryId: number },
  userToken: string
) {
  await processBroadcast({
    rideId,
    categoryId: String(driver.categoryId),
    originLat: DEFAULT_BOOKING.originLat,
    originLng: DEFAULT_BOOKING.originLng,
    rideType: DEFAULT_BOOKING.rideType,
    isReturnCab: false,
    broadcastRound: 1,
  })

  const acceptRes = await request(app)
    .post(`/api/v1/rides/${rideId}/accept`)
    .set('Authorization', `Bearer ${driver.accessToken}`)
  if (acceptRes.status !== 200) {
    throw new Error(`Accept failed for ride ${rideId}: ${JSON.stringify(acceptRes.body)}`)
  }

  const arrivedRes = await request(app)
    .post(`/api/v1/rides/${rideId}/arrived`)
    .set('Authorization', `Bearer ${driver.accessToken}`)
  if (arrivedRes.status !== 200) {
    throw new Error(`Arrived failed for ride ${rideId}: ${JSON.stringify(arrivedRes.body)}`)
  }

  const rideAsUser1 = await request(app)
    .get(`/api/v1/rides/${rideId}`)
    .set('Authorization', `Bearer ${userToken}`)
  const startOtp = rideAsUser1.body.startOtp as string

  const startOtpRes = await request(app)
    .post(`/api/v1/rides/${rideId}/start-otp`)
    .set('Authorization', `Bearer ${driver.accessToken}`)
    .send({ otp: startOtp })
  if (startOtpRes.status !== 200) {
    throw new Error(`Start OTP failed for ride ${rideId}: ${JSON.stringify(startOtpRes.body)}`)
  }

  return { startOtp }
}

export async function driveRideToCompletion(
  app: Express,
  rideId: string,
  driver: { accessToken: string; categoryId: number },
  userToken: string
) {
  const { startOtp } = await driveRideToInProgress(app, rideId, driver, userToken)

  const rideAsUser2 = await request(app)
    .get(`/api/v1/rides/${rideId}`)
    .set('Authorization', `Bearer ${userToken}`)
  const endOtp = rideAsUser2.body.endOtp as string

  const endOtpRes = await request(app)
    .post(`/api/v1/rides/${rideId}/end-otp`)
    .set('Authorization', `Bearer ${driver.accessToken}`)
    .send({ otp: endOtp, actual_distance_km: DEFAULT_BOOKING.distanceKm, actual_duration_min: DEFAULT_BOOKING.durationMin })
  if (endOtpRes.status !== 200) {
    throw new Error(`End OTP failed for ride ${rideId}: ${JSON.stringify(endOtpRes.body)}`)
  }

  await request(app)
    .post('/api/v1/rides/sessions/offline')
    .set('Authorization', `Bearer ${driver.accessToken}`)
    .send({})

  return { startOtp, endOtp }
}

// Full FK graph (confirmed against information_schema, not just grep) of every
// table that references rides(id) with NO ON DELETE CASCADE, in dependency order —
// grandchildren (referencing payments/ratings/disputes/ride_call_masks, not rides
// directly) first, then the direct rides children, then rides itself. This list is
// deliberately exhaustive: a missing entry here doesn't fail loudly in normal app
// use (nothing deletes a ride in production), it only surfaces as a test-teardown
// FK violation, which is easy to mistake for test flakiness instead of a real gap.
async function deleteRideAndDescendantsOnce(pool: Pool, rideIds: string[]) {
  await pool.query(
    `DELETE FROM payment_gateway_events WHERE payment_id IN (SELECT id FROM payments WHERE ride_id = ANY($1))`,
    [rideIds]
  )
  await pool.query(
    `DELETE FROM rating_tags WHERE rating_id IN (SELECT id FROM ratings WHERE ride_id = ANY($1))`,
    [rideIds]
  )
  await pool.query(
    `DELETE FROM dispute_evidence WHERE dispute_id IN (SELECT id FROM disputes WHERE ride_id = ANY($1))`,
    [rideIds]
  )
  await pool.query(
    `DELETE FROM dispute_actions WHERE dispute_id IN (SELECT id FROM disputes WHERE ride_id = ANY($1))`,
    [rideIds]
  )
  await pool.query(
    `DELETE FROM exotel_call_events WHERE ride_call_mask_id IN (SELECT id FROM ride_call_masks WHERE ride_id = ANY($1))`,
    [rideIds]
  )
  await pool.query('DELETE FROM driver_warnings WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM refunds WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM driver_earnings WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM driver_wallet_ledger WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM user_wallet_ledger WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM driver_package_ledger WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM tax_deductions WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM payments WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ratings WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM sos_alerts WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM disputes WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_call_masks WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_messages WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_status_history WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_otp_events WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_cancellations WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_assignments WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_stops WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM fare_snapshots WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_eta_snapshots WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM speed_alert_log WHERE ride_id = ANY($1)', [rideIds])
  await pool.query('DELETE FROM ride_advance_meta WHERE ride_id = ANY($1)', [rideIds])
  // gps_tracks.ride_id has NO FK to rides(id) — deliberate, per 005_m3_geo.sql's
  // own comment (FK checks on a partitioned parent would lock on every insert
  // at 450k rows/day; the app enforces integrity instead). So this delete isn't
  // needed to avoid an FK violation, only to avoid leaking orphaned breadcrumb
  // rows across test runs — nothing else ever cleans them up.
  await pool.query('DELETE FROM gps_tracks WHERE ride_id = ANY($1)', [rideIds])
  // driver_session_history.ride_id is ON DELETE SET NULL — no explicit delete needed.
  await pool.query('DELETE FROM rides WHERE id = ANY($1)', [rideIds])
}

/**
 * `insertEtaSnapshot` (rides.repository.ts) is deliberately fire-and-forget from
 * acceptRide/verifyStartOTP ("best-effort, never blocks the ride flow") — a test
 * that drives a ride through accept/start doesn't wait for that write, so it can
 * land after this cleanup's own ride_eta_snapshots delete but before the final
 * rides delete. Retry the whole descendant-delete pass a few times on FK failure
 * rather than chasing down every possible fire-and-forget writer individually.
 */
const POSTGRES_FOREIGN_KEY_VIOLATION = '23503'

async function deleteRideAndDescendants(pool: Pool, rideIds: string[]) {
  if (!rideIds.length) return
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await deleteRideAndDescendantsOnce(pool, rideIds)
      return
    } catch (err) {
      const isForeignKeyViolation = (err as { code?: string }).code === POSTGRES_FOREIGN_KEY_VIOLATION
      if (!isForeignKeyViolation || attempt === MAX_ATTEMPTS) throw err
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
    }
  }
}

export async function cleanupRideAndDriverData(pool: Pool, phones: string[]) {
  const { rows: driverRows } = await pool.query<{ id: string }>(
    'SELECT id FROM drivers WHERE phone = ANY($1)', [phones]
  )
  const driverIds = driverRows.map((r) => r.id)
  const { rows: userRows } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE phone = ANY($1)', [phones]
  )
  const userIds = userRows.map((r) => r.id)

  const { rows: rideRows } = await pool.query<{ id: string }>(
    'SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)', [userIds, driverIds]
  )
  await deleteRideAndDescendants(pool, rideRows.map((r) => r.id))

  if (driverIds.length) {
    // ride_assignments.driver_id/session_id: broadcast can offer a ride to this
    // driver as a candidate without them ever accepting, so the ride itself may
    // belong to a different user/driver pair than the one being cleaned up here
    // and never gets caught by the ride_id-scoped delete above. Must run before
    // driver_sessions is deleted (ride_assignments.session_id FKs driver_sessions).
    await pool.query('DELETE FROM ride_assignments WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_wallet_ledger WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_wallets WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_location_snapshots WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_sessions WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_verifications WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_vehicles WHERE driver_id = ANY($1)', [driverIds])
  }
  if (userIds.length) {
    // user_wallets.user_id is UNIQUE — any remaining ledger rows (not ride-scoped,
    // e.g. referral bonuses) must go before the wallet row itself.
    await pool.query('DELETE FROM user_wallet_ledger WHERE user_id = ANY($1)', [userIds])
    await pool.query('DELETE FROM user_wallets WHERE user_id = ANY($1)', [userIds])
  }
  await pool.query('DELETE FROM users WHERE phone = ANY($1)', [phones])
  await pool.query('DELETE FROM drivers WHERE phone = ANY($1)', [phones])
}
