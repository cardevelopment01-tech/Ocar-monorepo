import { pool } from '@/db/client'
import type { City, GpsTrackPayload } from './geo.types'

const CITY_COLS = `
  id::int, name, slug, state,
  ST_Y(centroid::geometry) AS centroid_lat,
  ST_X(centroid::geometry) AS centroid_lng,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled,
  created_at
`

export async function getActiveCities(): Promise<City[]> {
  const res = await pool.query(
    `SELECT ${CITY_COLS} FROM cities WHERE status = 'active' ORDER BY name`
  )
  return res.rows as City[]
}

export async function getAllCities(): Promise<City[]> {
  const res = await pool.query(
    `SELECT ${CITY_COLS} FROM cities ORDER BY name`
  )
  return res.rows as City[]
}

export async function getCityById(id: bigint): Promise<City | null> {
  const res = await pool.query(
    `SELECT ${CITY_COLS} FROM cities WHERE id = $1`,
    [id]
  )
  return res.rows[0] ?? null
}

export async function getCityBySlug(slug: string): Promise<City | null> {
  const res = await pool.query(
    `SELECT ${CITY_COLS} FROM cities WHERE slug = $1`,
    [slug]
  )
  return res.rows[0] ?? null
}

export async function findNearestCity(lat: number, lng: number): Promise<City | null> {
  const res = await pool.query(
    `SELECT
       ${CITY_COLS},
       ST_Distance(
         centroid,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography
       ) AS distance_metres
     FROM cities
     WHERE status = 'active'
     ORDER BY distance_metres ASC
     LIMIT 1`,
    [lat, lng]
  )
  return res.rows[0] ?? null
}

export async function findContainingCity(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<{ id: number; name: string } | null> {
  const res = await pool.query(
    `SELECT id::int, name
     FROM cities
     WHERE boundary IS NOT NULL
       AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326))
       AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326))
     LIMIT 1`,
    [originLat, originLng, destLat, destLng]
  )
  return res.rows[0] ?? null
}

export async function insertGpsTracks(tracks: GpsTrackPayload[]): Promise<void> {
  if (!tracks.length) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const t of tracks) {
      await client.query(
        `INSERT INTO gps_tracks
           (ride_id, session_id, driver_id, location,
            heading, speed_kmph, accuracy_metres, recorded_at)
         VALUES (
           $1, $2, $3,
           ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography,
           $6, $7, $8, $9
         )
         ON CONFLICT DO NOTHING`,
        [
          t.ride_id,
          t.session_id,
          t.driver_id,
          t.latitude,
          t.longitude,
          t.heading ?? null,
          t.speed_kmph ?? null,
          t.accuracy_metres ?? null,
          t.recorded_at,
        ]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function lookupGeoCache(
  normalizedAddress: string
): Promise<{ latitude: number; longitude: number; raw_address: string } | null> {
  const res = await pool.query(
    `UPDATE place_geocode_cache
     SET hit_count = hit_count + 1,
         last_hit_at = now()
     WHERE normalized_address = $1
       AND expires_at > now()
     RETURNING latitude, longitude, raw_address`,
    [normalizedAddress]
  )
  return res.rows[0] ?? null
}

export async function storeGeoCache(data: {
  normalizedAddress: string
  rawAddress: string
  latitude: number
  longitude: number
  provider: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO place_geocode_cache
       (normalized_address, raw_address, location,
        latitude, longitude, provider, expires_at)
     VALUES (
       $1, $2,
       ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography,
       $3, $4, $5,
       now() + INTERVAL '90 days'
     )
     ON CONFLICT (normalized_address) DO UPDATE
       SET hit_count  = place_geocode_cache.hit_count + 1,
           last_hit_at = now(),
           expires_at  = now() + INTERVAL '90 days'`,
    [
      data.normalizedAddress,
      data.rawAddress,
      data.latitude,
      data.longitude,
      data.provider,
    ]
  )
}

export async function createCity(data: {
  name: string
  slug: string
  state: string
  centroid_lat: number
  centroid_lng: number
  default_speed_limit_kmph: number
  is_rental_enabled: boolean
  is_return_cab_enabled: boolean
  created_by: bigint | null
}): Promise<City> {
  const res = await pool.query(
    `INSERT INTO cities
       (name, slug, state, centroid,
        default_speed_limit_kmph,
        is_rental_enabled, is_return_cab_enabled,
        created_by)
     VALUES (
       $1, $2, $3,
       ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography,
       $6, $7, $8, $9
     )
     RETURNING ${CITY_COLS}`,
    [
      data.name, data.slug, data.state,
      data.centroid_lat, data.centroid_lng,
      data.default_speed_limit_kmph,
      data.is_rental_enabled,
      data.is_return_cab_enabled,
      data.created_by,
    ]
  )
  return res.rows[0] as City
}

export async function updateCity(
  id: bigint,
  data: {
    name?: string
    state?: string
    default_speed_limit_kmph?: number
    status?: string
    is_rental_enabled?: boolean
    is_return_cab_enabled?: boolean
  }
): Promise<City | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let p = 1

  if (data.name !== undefined)                   { sets.push(`name = $${p++}`);                    values.push(data.name) }
  if (data.state !== undefined)                  { sets.push(`state = $${p++}`);                   values.push(data.state) }
  if (data.default_speed_limit_kmph !== undefined){ sets.push(`default_speed_limit_kmph = $${p++}`); values.push(data.default_speed_limit_kmph) }
  if (data.status !== undefined)                 { sets.push(`status = $${p++}`);                  values.push(data.status) }
  if (data.is_rental_enabled !== undefined)      { sets.push(`is_rental_enabled = $${p++}`);       values.push(data.is_rental_enabled) }
  if (data.is_return_cab_enabled !== undefined)  { sets.push(`is_return_cab_enabled = $${p++}`);   values.push(data.is_return_cab_enabled) }

  if (!sets.length) return getCityById(id)

  values.push(id)
  const res = await pool.query(
    `UPDATE cities SET ${sets.join(', ')} WHERE id = $${p} RETURNING ${CITY_COLS}`,
    values
  )
  return res.rows[0] ?? null
}
