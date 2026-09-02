import type { Express } from 'express'
import request from 'supertest'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'

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
  const plate = opts.plate ?? `OD02${Math.floor(1000 + Math.random() * 8999)}`
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
 * Deletes rows referencing rides/drivers, in FK-safe order. Most of these tables
 * have no ON DELETE CASCADE from rides/drivers so explicit deletion is required;
 * driver_vehicles is the one exception (CASCADEs from drivers) but deleting it
 * explicitly first is still correct and harmless. payment_gateway_events and
 * refunds reference payments (not rides) directly, and refunds also references
 * disputes, so they must be deleted before payments/disputes, which in turn
 * must be deleted before rides.
 */
export async function cleanupRideAndDriverData(pool: Pool, phones: string[]) {
  const { rows: driverRows } = await pool.query<{ id: string }>(
    'SELECT id FROM drivers WHERE phone = ANY($1)', [phones]
  )
  const driverIds = driverRows.map((r) => r.id)
  const { rows: userRows } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE phone = ANY($1)', [phones]
  )
  const userIds = userRows.map((r) => r.id)

  if (driverIds.length || userIds.length) {
    // payment_gateway_events -> refunds -> payments (refunds also FKs rides + disputes,
    // so it must go before both payments and disputes); ratings/sos_alerts/disputes/
    // ride_messages all FK rides directly with no ON DELETE CASCADE.
    await pool.query(
      `DELETE FROM payment_gateway_events WHERE payment_id IN (
         SELECT id FROM payments WHERE ride_id IN (
           SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
         )
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM refunds WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM payments WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM ratings WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM sos_alerts WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM disputes WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM ride_messages WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM ride_status_history WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM ride_otp_events WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM ride_cancellations WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM ride_assignments WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM ride_stops WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query(
      `DELETE FROM fare_snapshots WHERE ride_id IN (
         SELECT id FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)
       )`,
      [userIds, driverIds]
    )
    await pool.query('DELETE FROM rides WHERE user_id = ANY($1) OR driver_id = ANY($2)', [userIds, driverIds])
  }
  if (driverIds.length) {
    await pool.query('DELETE FROM driver_wallet_ledger WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_wallets WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_location_snapshots WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_sessions WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_verifications WHERE driver_id = ANY($1)', [driverIds])
    await pool.query('DELETE FROM driver_vehicles WHERE driver_id = ANY($1)', [driverIds])
  }
  await pool.query('DELETE FROM users WHERE phone = ANY($1)', [phones])
  await pool.query('DELETE FROM drivers WHERE phone = ANY($1)', [phones])
}
