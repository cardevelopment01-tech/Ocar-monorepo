import { pool } from '@/db/client'
import { cachedRead, invalidate } from '@/lib/cache/reference-cache'
import { client as redisClient, getJSON, setWithTTL } from '@/db/redis'
import { rateCardKey, RATE_CARD_VERSION_KEY, stopChargeKey, rentalPackageKey, surgeKey } from '@/constants/redis-keys'
import { RATE_CARD_CACHE_TTL_SECONDS, STRUCTURAL_CACHE_TTL_SECONDS } from '@/constants/limits'
import { logger } from '@/lib/logger'

const SURGE_BASE_TTL_SECONDS = 300

function secondsUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / 1000)
}

async function getRateCardVersion(): Promise<string> {
  try {
    return (await redisClient.get(RATE_CARD_VERSION_KEY)) ?? '0'
  } catch {
    return '0'
  }
}

export async function getCurrentRateCard(categoryId: number, rideType: string, cityId: number | null) {
  const version = await getRateCardVersion()
  const key = rateCardKey(version, categoryId, rideType, cityId)
  return cachedRead('rate_cards', key, RATE_CARD_CACHE_TTL_SECONDS, () =>
    fetchCurrentRateCardFromDb(categoryId, rideType, cityId)
  )
}

async function fetchCurrentRateCardFromDb(categoryId: number, rideType: string, cityId: number | null) {
  const res = await pool.query(
    `SELECT rc.*,
            vc.display_name AS category_name,
            vc.slug AS category_slug
     FROM rate_cards rc
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     WHERE rc.category_id = $1
       AND rc.ride_type = $2
       AND rc.effective_to IS NULL
       AND (rc.city_id = $3 OR rc.city_id IS NULL)
     ORDER BY rc.city_id NULLS LAST
     LIMIT 1`,
    [categoryId, rideType, cityId]
  )
  return res.rows[0] ?? null
}

export async function getAllCurrentRateCards() {
  const res = await pool.query(
    `SELECT rc.*,
            vc.display_name AS category_name,
            vc.slug AS category_slug,
            c.name AS city_name
     FROM rate_cards rc
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     LEFT JOIN cities c ON c.id = rc.city_id
     WHERE rc.effective_to IS NULL
     ORDER BY c.name NULLS FIRST, vc.display_name, rc.ride_type`
  )
  return res.rows
}

export async function getRateCardHistory() {
  const res = await pool.query(
    `SELECT rch.*,
            vc.display_name AS category_name,
            rc.ride_type
     FROM rate_card_history rch
     JOIN rate_cards rc ON rc.id = rch.rate_card_id
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     ORDER BY rch.created_at DESC
     LIMIT 100`
  )
  return res.rows
}

export async function getStopCharge(categoryId: number): Promise<number> {
  return cachedRead(
    'stop_charges',
    stopChargeKey(categoryId),
    STRUCTURAL_CACHE_TTL_SECONDS,
    () => fetchStopChargeFromDb(categoryId)
  ) as Promise<number>
}

async function fetchStopChargeFromDb(categoryId: number): Promise<number> {
  const res = await pool.query(
    `SELECT charge_per_stop FROM stop_charges WHERE category_id = $1`,
    [categoryId]
  )
  return parseFloat(res.rows[0]?.charge_per_stop ?? '0')
}

export async function getRentalPackage(packageId: number) {
  return cachedRead(
    'rental_packages',
    rentalPackageKey(packageId),
    RATE_CARD_CACHE_TTL_SECONDS,
    () => fetchRentalPackageFromDb(packageId)
  )
}

async function fetchRentalPackageFromDb(packageId: number) {
  const res = await pool.query(
    `SELECT rp.*, vc.display_name AS category_name
     FROM rental_packages rp
     JOIN vehicle_categories vc ON vc.id = rp.category_id
     WHERE rp.id = $1 AND rp.is_active = true`,
    [packageId]
  )
  return res.rows[0] ?? null
}

export async function getRentalPackagesByCategory(categoryId: number, cityId: number | null) {
  const res = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (rp.duration_minutes, rp.km_limit)
              rp.*, vc.display_name AS category_name, c.name AS city_name
       FROM rental_packages rp
       JOIN vehicle_categories vc ON vc.id = rp.category_id
       LEFT JOIN cities c ON c.id = rp.city_id
       WHERE rp.category_id = $1
         AND rp.is_active = true
         AND (rp.city_id = $2 OR rp.city_id IS NULL)
       ORDER BY rp.duration_minutes, rp.km_limit, rp.city_id NULLS LAST
     ) t
     ORDER BY t.display_order, t.duration_minutes`,
    [categoryId, cityId]
  )
  return res.rows
}

// This does NOT use cachedRead: cachedRead needs a fixed ttlSeconds up front,
// but the whole point here is a TTL clamped to the fetched row's own ends_at
// (a naive fixed TTL would keep applying a surge multiplier past its actual
// end, overcharging riders). The plan's literal snippet called
// fetchActiveSurgeFromDb once unconditionally on every invocation (to compute
// the clamp) and then again inside cachedRead on a miss -- that unconditional
// outer call defeats caching entirely, since it hits the DB on every call
// regardless of cache state. Instead: check the cache first, and only fetch
// from the DB on a genuine miss, computing the clamp from that same fetched
// row before writing it back.
//
// Deliberately NOT negative-caching the "no active surge" case (unlike
// cachedRead's built-in negative caching) -- caching "no surge" at any TTL
// would delay a newly-scheduled surge from taking effect until that TTL
// expires, which is exactly the bug this task exists to avoid.
export async function getActiveSurge(cityId: number, categoryId: number) {
  const key = surgeKey(cityId, categoryId)
  try {
    const cached = await getJSON<Record<string, unknown>>(key)
    if (cached !== null) return cached
  } catch (err) {
    logger.warn({ err, key }, 'reference-cache: surge cache read failed, falling through to DB')
  }

  const row = await fetchActiveSurgeFromDb(cityId, categoryId)
  if (!row) return null

  const ttl = Math.max(1, Math.min(SURGE_BASE_TTL_SECONDS, secondsUntil(new Date(row.ends_at))))
  try {
    await setWithTTL(key, JSON.stringify(row), ttl)
  } catch (err) {
    logger.warn({ err, key }, 'reference-cache: failed to populate surge cache, serving DB value')
  }
  return row
}

async function fetchActiveSurgeFromDb(cityId: number, categoryId: number) {
  const res = await pool.query(
    `SELECT * FROM surge_events
     WHERE city_id = $1
       AND (category_id = $2 OR category_id IS NULL)
       AND status = 'active'
       AND starts_at <= now()
       AND ends_at > now()
     ORDER BY
       CASE WHEN category_id IS NOT NULL THEN 0 ELSE 1 END,
       multiplier DESC
     LIMIT 1`,
    [cityId, categoryId]
  )
  return res.rows[0] ?? null
}

export async function getAllSurgeEvents() {
  const res = await pool.query(
    `SELECT se.*,
            c.name AS city_name,
            vc.display_name AS category_name
     FROM surge_events se
     JOIN cities c ON c.id = se.city_id
     LEFT JOIN vehicle_categories vc ON vc.id = se.category_id
     ORDER BY se.created_at DESC`
  )
  return res.rows
}

// category_id IS NULL means "applies to all categories" (same NULL-fallback
// convention as rate_cards' city_id) -- a write to that row can change the
// winning surge for EVERY category's cache entry, not just one. surgeKey is
// always built with a concrete categoryId (getActiveSurge is only ever called
// with the requesting ride's actual category), so a null-category write can't
// be expressed as a single key. Enumerate the small, mostly-static category
// list and invalidate each one's key for this city rather than leaving the
// other categories' entries to expire on their own TTL.
async function invalidateSurgeCache(cityId: number, categoryId: number | null): Promise<void> {
  if (categoryId !== null) {
    await invalidate(surgeKey(cityId, categoryId))
    return
  }
  try {
    const res = await pool.query('SELECT id FROM vehicle_categories')
    await invalidate(...res.rows.map((r) => surgeKey(cityId, Number(r.id))))
  } catch (err) {
    logger.warn({ err, cityId }, 'reference-cache: failed to enumerate categories for surge invalidation, will serve stale until TTL')
  }
}

export async function createSurgeEvent(data: {
  cityId: number
  categoryId: number | null
  multiplier: number
  reason: string | null
  startsAt: string
  endsAt: string
  adminId: number
}) {
  const res = await pool.query(
    `INSERT INTO surge_events
       (city_id, category_id, multiplier, reason,
        status, starts_at, ends_at, created_by)
     VALUES ($1,$2,$3,$4,'scheduled',$5,$6,$7)
     RETURNING *`,
    [
      data.cityId, data.categoryId, data.multiplier, data.reason,
      data.startsAt, data.endsAt, data.adminId,
    ]
  )
  const row = res.rows[0]
  await invalidateSurgeCache(data.cityId, data.categoryId)
  return row
}

export async function cancelSurgeEvent(id: number, adminId: number) {
  const res = await pool.query(
    `UPDATE surge_events
     SET status = 'cancelled',
         cancelled_by = $2,
         cancelled_at = now()
     WHERE id = $1
       AND status IN ('scheduled', 'active')
     RETURNING *`,
    [id, adminId]
  )
  const row = res.rows[0] ?? null
  if (row) await invalidateSurgeCache(Number(row.city_id), row.category_id === null ? null : Number(row.category_id))
  return row
}

export async function createRateCard(data: {
  categoryId: number
  rideType: string
  ratePerKm: number
  ratePerMin: number
  minFare: number
  returnRatePerKm?: number | null
  hourRate?: number | null
  kmPerDay?: number | null
  driverAllowancePerDay?: number | null
  cityId?: number | null
  notes?: string | null
  adminId: number
}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const expired = await client.query(
      `UPDATE rate_cards
       SET effective_to = now()
       WHERE category_id = $1 AND ride_type = $2
         AND COALESCE(city_id, 0) = COALESCE($3::bigint, 0)
         AND effective_to IS NULL
       RETURNING *`,
      [data.categoryId, data.rideType, data.cityId ?? null]
    )

    if (expired.rows.length > 0) {
      const old = expired.rows[0]
      await client.query(
        `INSERT INTO rate_card_history
           (rate_card_id, rate_per_km, rate_per_min, min_fare,
            return_rate_per_km, hour_rate, km_per_day, driver_allowance_per_day,
            city_id, changed_by, change_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          old.id, old.rate_per_km, old.rate_per_min, old.min_fare,
          old.return_rate_per_km, old.hour_rate, old.km_per_day, old.driver_allowance_per_day,
          old.city_id, data.adminId, data.notes ?? null,
        ]
      )
    }

    const res = await client.query(
      `INSERT INTO rate_cards
         (category_id, ride_type, rate_per_km, rate_per_min,
          min_fare, return_rate_per_km, hour_rate, km_per_day, driver_allowance_per_day,
          city_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        data.categoryId, data.rideType,
        data.ratePerKm, data.ratePerMin, data.minFare,
        data.returnRatePerKm ?? null,
        data.hourRate ?? null,
        data.kmPerDay ?? null,
        data.driverAllowancePerDay ?? null,
        data.cityId ?? null,
        data.notes ?? null,
        data.adminId,
      ]
    )

    await client.query('COMMIT')
    try {
      await redisClient.incr(RATE_CARD_VERSION_KEY)
    } catch (err) {
      logger.warn({ err }, 'reference-cache: failed to bump rate_card version, will serve stale until TTL')
    }
    return res.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
