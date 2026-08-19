#!/usr/bin/env node
/**
 * load-tests/seed/generate-bulk-ride-history.js
 *
 * Seeds historical ride volume (rides + ride_status_history + fare_snapshots
 * + payments, optionally gps_tracks) so query-performance work (EXPLAIN
 * ANALYZE, index audits, the keyset-pagination/partitioning decision noted
 * in CLAUDE.md) has real data to run against. This is a DIFFERENT axis from
 * the k6 scripts in ../k6/ — those test concurrent connections, this tests
 * data volume. Run both for a full picture.
 *
 * WHY BATCHED INSERT, NOT COPY:
 * 1M rides at ~1000 rows/statement is ~1000 round trips, a few minutes total
 * — no new dependency needed. COPY (via pg-copy-streams) would be faster but
 * isn't worth a new dependency at this volume. See the ponytail: comment
 * near the gps_tracks insert for the one case where that math changes.
 *
 * WHY REUSE EXISTING USERS/DRIVERS INSTEAD OF FABRICATING THEM HERE:
 * Same reserved-block invariant as generate-test-tokens.js — one script
 * owns "what a synthetic user/driver looks like". This script only adds
 * ride-scoped rows on top of accounts that script already created.
 * Run generate-test-tokens.js first.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... \
 *   node generate-bulk-ride-history.js --rides 1000000 --months 12
 *
 * Cleanup: see the SQL block this script prints at the end, or re-run with
 * --cleanup to execute it directly.
 */

const { Client } = require('pg')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const NUM_RIDES = parseInt(arg('rides', '1000000'), 10)
const MONTHS = parseInt(arg('months', '12'), 10)
const BATCH_SIZE = parseInt(arg('batch-size', '1000'), 10)
const GPS_PER_RIDE = parseInt(arg('gps-per-ride', '0'), 10)
const COMPLETED_PCT = parseInt(arg('completed-pct', '80'), 10)
const CANCELLED_PCT = parseInt(arg('cancelled-pct', '15'), 10)
const FORCE = process.argv.includes('--i-know-what-im-doing')
const DO_CLEANUP = process.argv.includes('--cleanup')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required (copy from staging api-env).')
  process.exit(1)
}
// Check the HOSTNAME only, not the full connection string — the scheme
// "postgresql://" itself contains the substring "stg", which would falsely
// satisfy a staging/dev exclusion checked against the whole URL.
function dbHost(url) {
  try { return new URL(url).hostname } catch { return url }
}
if (!FORCE && /prod/i.test(dbHost(DATABASE_URL)) && !/staging|stg|test|dev/i.test(dbHost(DATABASE_URL))) {
  console.error(
    `DATABASE_URL looks like it might point at production ("${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}").\n` +
    'This script writes ~1M synthetic rows. Re-run against staging, or pass --i-know-what-im-doing to override.'
  )
  process.exit(1)
}

const CLEANUP_SQL = `
DELETE FROM payments            WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '99999%'));
DELETE FROM gps_tracks          WHERE session_id IN (SELECT id FROM driver_sessions WHERE offline_reason = 'load_test_seed');
DELETE FROM fare_snapshots      WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '99999%'));
DELETE FROM ride_status_history WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '99999%'));
DELETE FROM rides               WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '99999%');
DELETE FROM driver_sessions     WHERE offline_reason = 'load_test_seed';
`.trim()

function randOf(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function randRange(min, max) { return min + Math.random() * (max - min) }
function jitter(base, spread) { return base + (Math.random() - 0.5) * spread }

// Skews toward recent dates (real tables aren't uniformly dated) — exponent
// controls the skew; 1.5 means ~half the rows land in the most recent ~40%
// of the window.
function skewedPastDate(months) {
  const daysBack = Math.floor(Math.random() ** 1.5 * months * 30)
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  d.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0)
  return d
}
function addMinutes(date, min) { return new Date(date.getTime() + min * 60000) }

// Generic batched multi-row INSERT. Chunks automatically so no statement
// exceeds Postgres's 65535 bind-parameter ceiling.
async function insertRows(client, table, columns, rows, returning) {
  if (rows.length === 0) return []
  const maxRowsPerStmt = Math.max(1, Math.floor(60000 / columns.length))
  const out = []
  for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
    const chunk = rows.slice(i, i + maxRowsPerStmt)
    const values = []
    const placeholders = chunk.map((row) => {
      const ph = row.map((v) => { values.push(v); return `$${values.length}` })
      return `(${ph.join(',')})`
    })
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders.join(',')}` +
      (returning ? ` RETURNING ${returning}` : '')
    const res = await client.query(sql, values)
    if (returning) out.push(...res.rows.map((r) => r[returning]))
  }
  return out
}

// rides needs raw PostGIS expressions for origin/destination, so it gets its
// own builder instead of the generic column=$n helper above.
async function insertRides(client, rows) {
  const cols = [
    'user_id', 'driver_id', 'session_id', 'vehicle_id', 'category_id', 'ride_type',
    'is_return_cab', 'status', 'origin', 'destination', 'origin_address',
    'destination_address', 'origin_city_id', 'destination_city_id', 'requested_at',
    'accepted_at', 'driver_arrived_at', 'started_at', 'completed_at', 'cancelled_at',
    'actual_distance_km', 'actual_duration_min',
  ]
  const paramsPerRow = 24 // 2 extra for origin/destination lng+lat pairs
  const maxRowsPerStmt = Math.max(1, Math.floor(60000 / paramsPerRow))
  const ids = []
  for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
    const chunk = rows.slice(i, i + maxRowsPerStmt)
    const values = []
    const placeholders = chunk.map((r) => {
      const p = (v) => { values.push(v); return `$${values.length}` }
      return `(${p(r.userId)},${p(r.driverId)},${p(r.sessionId)},${p(r.vehicleId)},${p(r.categoryId)},${p(r.rideType)},` +
        `${p(r.isReturnCab)},${p(r.status)},` +
        `ST_SetSRID(ST_MakePoint(${p(r.originLng)}::float8,${p(r.originLat)}::float8),4326)::geography,` +
        `ST_SetSRID(ST_MakePoint(${p(r.destLng)}::float8,${p(r.destLat)}::float8),4326)::geography,` +
        `${p(r.originAddress)},${p(r.destAddress)},${p(r.originCityId)},${p(r.destCityId)},${p(r.requestedAt)},` +
        `${p(r.acceptedAt)},${p(r.driverArrivedAt)},${p(r.startedAt)},${p(r.completedAt)},${p(r.cancelledAt)},` +
        `${p(r.actualDistanceKm)},${p(r.actualDurationMin)})`
    })
    const sql = `INSERT INTO rides (${cols.join(',')}) VALUES ${placeholders.join(',')} RETURNING id`
    const res = await client.query(sql, values)
    ids.push(...res.rows.map((row) => row.id))
  }
  return ids
}

async function insertGpsTracks(client, rows) {
  const cols = ['ride_id', 'driver_id', 'session_id', 'location', 'heading', 'speed_kmph', 'accuracy_metres', 'recorded_at']
  const paramsPerRow = 9
  const maxRowsPerStmt = Math.max(1, Math.floor(60000 / paramsPerRow))
  for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
    const chunk = rows.slice(i, i + maxRowsPerStmt)
    const values = []
    const placeholders = chunk.map((r) => {
      const p = (v) => { values.push(v); return `$${values.length}` }
      return `(${p(r.rideId)},${p(r.driverId)},${p(r.sessionId)},` +
        `ST_SetSRID(ST_MakePoint(${p(r.lng)}::float8,${p(r.lat)}::float8),4326)::geography,` +
        `${p(r.heading)},${p(r.speedKmph)},${p(r.accuracyMetres)},${p(r.recordedAt)})`
    })
    const sql = `INSERT INTO gps_tracks (${cols.join(',')}) VALUES ${placeholders.join(',')}`
    await client.query(sql, values)
  }
}

async function main() {
  if (DO_CLEANUP) {
    const client = new Client({ connectionString: DATABASE_URL })
    await client.connect()
    console.log('Running cleanup...')
    await client.query(CLEANUP_SQL)
    console.log('Done.')
    await client.end()
    return
  }

  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()

  const existing = await client.query(
    `SELECT count(*)::int AS n FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '99999%')`
  )
  if (existing.rows[0].n > 0 && !FORCE) {
    console.error(
      `${existing.rows[0].n} seeded rides already exist. This script is additive, not idempotent — ` +
      're-running ADDS more rows on top. Clean up first with --cleanup, or pass --i-know-what-im-doing to add anyway.'
    )
    process.exit(1)
  }

  const users = (await client.query(`SELECT id FROM users WHERE phone LIKE '99999%'`)).rows
  if (users.length === 0) {
    console.error('No synthetic users found. Run generate-test-tokens.js first.')
    process.exit(1)
  }

  const driverRows = (await client.query(
    `SELECT d.id, dv.id AS vehicle_id, dv.category_id, d.city_id
     FROM drivers d
     JOIN driver_vehicles dv ON dv.driver_id = d.id AND dv.status = 'active'
     WHERE d.status = 'active' AND d.city_id IS NOT NULL`
  )).rows
  if (driverRows.length === 0) {
    console.error('No active drivers with an active vehicle + city found. Run generate-test-tokens.js first.')
    process.exit(1)
  }

  const cities = (await client.query(
    `SELECT id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM cities WHERE status = 'active'`
  )).rows
  if (cities.length < 2) {
    console.error('Need at least 2 active cities for realistic origin/destination pairs.')
    process.exit(1)
  }
  const cityById = new Map(cities.map((c) => [c.id, c]))

  // One rate card per category for 'one_way' — the only ride_type this
  // script seeds (see below).
  const rateCards = (await client.query(
    `SELECT id, category_id, rate_per_km, rate_per_min, min_fare
     FROM rate_cards WHERE effective_to IS NULL AND city_id IS NULL AND ride_type = 'one_way'`
  )).rows
  const rateCardByCategory = new Map(rateCards.map((r) => [r.category_id, r]))

  console.log(`Reference data: ${users.length} users, ${driverRows.length} drivers, ${cities.length} cities, ${rateCards.length} rate cards.`)

  // ── driver_sessions: one per reused driver, needed as a valid FK target
  //    for rides.session_id and gps_tracks.session_id.
  const sessionRows = driverRows.map((d) => [d.id, d.vehicle_id, d.category_id, 'standard', 'offline', 'load_test_seed'])
  const sessionIds = await insertRows(
    client, 'driver_sessions',
    ['driver_id', 'vehicle_id', 'category_id', 'mode', 'status', 'offline_reason'],
    sessionRows, 'id'
  )
  const drivers = driverRows.map((d, i) => ({ ...d, sessionId: sessionIds[i] }))
  console.log(`Created ${drivers.length} driver_sessions (offline_reason='load_test_seed').`)

  // ── gps_tracks partitions for the whole date range, if we're seeding them.
  if (GPS_PER_RIDE > 0) {
    const now = new Date()
    for (let i = 0; i <= MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      await client.query('SELECT create_gps_partition($1, $2)', [d.getFullYear(), d.getMonth() + 1])
    }
    console.log(`Ensured gps_tracks partitions for the last ${MONTHS} months.`)
  }

  // ── generate + insert in batches
  const startTime = Date.now()
  let ridesDone = 0, statusRowsDone = 0, fareRowsDone = 0, paymentRowsDone = 0, gpsRowsDone = 0

  while (ridesDone < NUM_RIDES) {
    const batchSize = Math.min(BATCH_SIZE, NUM_RIDES - ridesDone)
    const rideDrafts = []

    for (let i = 0; i < batchSize; i++) {
      const driver = randOf(drivers)
      const user = randOf(users)
      const originCity = cityById.get(driver.city_id) || randOf(cities)
      const destCity = randOf(cities.filter((c) => c.id !== originCity.id)) || originCity
      const rateCard = rateCardByCategory.get(driver.category_id)

      const roll = Math.random() * 100
      const status = roll < COMPLETED_PCT ? 'completed' : roll < COMPLETED_PCT + CANCELLED_PCT ? 'cancelled' : 'no_drivers'

      const requestedAt = skewedPastDate(MONTHS)
      const distanceKm = Math.round(randRange(8, 60) * 100) / 100
      const durationMin = Math.round(distanceKm * randRange(1.2, 1.8) * 100) / 100

      let acceptedAt = null, driverArrivedAt = null, startedAt = null, completedAt = null, cancelledAt = null
      let actualDistanceKm = null, actualDurationMin = null

      if (status === 'completed') {
        acceptedAt = addMinutes(requestedAt, randRange(0.5, 3))
        driverArrivedAt = addMinutes(acceptedAt, randRange(2, 8))
        startedAt = addMinutes(driverArrivedAt, randRange(1, 3))
        completedAt = addMinutes(startedAt, durationMin * randRange(0.9, 1.1))
        actualDistanceKm = Math.round(distanceKm * randRange(0.9, 1.1) * 100) / 100
        actualDurationMin = Math.round((completedAt - startedAt) / 60000 * 100) / 100
      } else if (status === 'cancelled') {
        cancelledAt = addMinutes(requestedAt, randRange(0.5, 10))
      }
      // no_drivers: only requested_at set

      rideDrafts.push({
        userId: user.id, driverId: driver.id, sessionId: driver.sessionId, vehicleId: driver.vehicle_id,
        categoryId: driver.category_id, rideType: 'one_way', isReturnCab: false, status,
        originLng: jitter(originCity.lng, 0.08), originLat: jitter(originCity.lat, 0.08),
        destLng: jitter(destCity.lng, 0.08), destLat: jitter(destCity.lat, 0.08),
        originAddress: 'Load test pickup', destAddress: 'Load test drop',
        originCityId: originCity.id, destCityId: destCity.id,
        requestedAt, acceptedAt, driverArrivedAt, startedAt, completedAt, cancelledAt,
        actualDistanceKm, actualDurationMin,
        // carried through for fare/payment generation below, not ride columns
        _distanceKm: distanceKm, _durationMin: durationMin, _rateCard: rateCard,
      })
    }

    const rideIds = await insertRides(client, rideDrafts)

    // ── ride_status_history
    const statusRows = []
    rideDrafts.forEach((r, i) => {
      const rideId = rideIds[i]
      statusRows.push([rideId, null, 'requested', 'user', r.userId, r.requestedAt])
      if (r.status === 'completed') {
        statusRows.push([rideId, 'requested', 'accepted', 'driver', r.driverId, r.acceptedAt])
        statusRows.push([rideId, 'accepted', 'driver_arrived', 'driver', r.driverId, r.driverArrivedAt])
        statusRows.push([rideId, 'driver_arrived', 'in_progress', 'driver', r.driverId, r.startedAt])
        statusRows.push([rideId, 'in_progress', 'completed', 'ride_completion', r.driverId, r.completedAt])
      } else if (r.status === 'cancelled') {
        statusRows.push([rideId, 'requested', 'cancelled', 'user', r.userId, r.cancelledAt])
      } else {
        statusRows.push([rideId, 'requested', 'no_drivers', 'system', null, r.requestedAt])
      }
    })
    await insertRows(client, 'ride_status_history', ['ride_id', 'from_status', 'to_status', 'actor', 'actor_id', 'created_at'], statusRows)
    statusRowsDone += statusRows.length

    // ── fare_snapshots (every ride gets an estimate; completed gets a final)
    const fareDrafts = rideDrafts.map((r, i) => {
      const rc = r._rateCard
      const baseFare = rc ? Number(rc.min_fare) : 200
      const distanceFare = rc ? Math.round(Number(rc.rate_per_km) * r._distanceKm * 100) / 100 : 0
      const timeFare = rc ? Math.round(Number(rc.rate_per_min) * r._durationMin * 100) / 100 : 0
      const totalEstimated = Math.round((baseFare + distanceFare + timeFare) * 100) / 100
      const isFinal = r.status === 'completed'
      const actualDistanceFare = isFinal ? Math.round((rc ? Number(rc.rate_per_km) : 0) * r.actualDistanceKm * 100) / 100 : null
      const totalFinal = isFinal ? Math.round((baseFare + actualDistanceFare + timeFare) * 100) / 100 : null
      return {
        rideId: rideIds[i], rateCardId: rc ? rc.id : null, rideType: 'one_way', isReturnCab: false,
        surgeMultiplier: 1.0, estimatedKm: r._distanceKm, estimatedMin: r._durationMin, stopCount: 0, tripHours: 0,
        actualKm: r.actualDistanceKm, actualMin: r.actualDurationMin, overageKm: 0, overageMin: 0,
        baseFare, distanceFare, timeFare, stopFare: 0, hourSurcharge: 0, overageFare: 0, surgeFare: 0,
        totalEstimated, totalFinal, status: isFinal ? 'final' : 'estimate', finalisedAt: isFinal ? r.completedAt : null,
      }
    })
    const fareCols = [
      'ride_id', 'rate_card_id', 'ride_type', 'is_return_cab', 'surge_multiplier', 'estimated_km', 'estimated_min',
      'stop_count', 'trip_hours', 'actual_km', 'actual_min', 'overage_km', 'overage_min', 'base_fare', 'distance_fare',
      'time_fare', 'stop_fare', 'hour_surcharge', 'overage_fare', 'surge_fare', 'total_estimated', 'total_final',
      'status', 'finalised_at',
    ]
    const fareRows = fareDrafts.map((f) => [
      f.rideId, f.rateCardId, f.rideType, f.isReturnCab, f.surgeMultiplier, f.estimatedKm, f.estimatedMin,
      f.stopCount, f.tripHours, f.actualKm, f.actualMin, f.overageKm, f.overageMin, f.baseFare, f.distanceFare,
      f.timeFare, f.stopFare, f.hourSurcharge, f.overageFare, f.surgeFare, f.totalEstimated, f.totalFinal,
      f.status, f.finalisedAt,
    ])
    const fareSnapshotIds = await insertRows(client, 'fare_snapshots', fareCols, fareRows, 'id')
    fareRowsDone += fareRows.length

    // ── payments (completed rides only)
    const paymentRows = []
    rideDrafts.forEach((r, i) => {
      if (r.status !== 'completed') return
      const amount = fareDrafts[i].totalFinal
      const commissionAmount = Math.round(amount * 0.15 * 100) / 100
      const driverEarning = Math.round((amount - commissionAmount) * 100) / 100
      paymentRows.push([
        rideIds[i], r.userId, r.driverId, fareSnapshotIds[i], amount, 'cash_direct', 'completed',
        15.00, commissionAmount, driverEarning, r.completedAt,
      ])
    })
    await insertRows(
      client, 'payments',
      ['ride_id', 'user_id', 'driver_id', 'fare_snapshot_id', 'amount', 'channel', 'status', 'commission_percent', 'commission_amount', 'driver_earning', 'captured_at'],
      paymentRows
    )
    paymentRowsDone += paymentRows.length

    // ── gps_tracks (optional, completed rides only, linear-interpolated breadcrumb)
    if (GPS_PER_RIDE > 0) {
      const gpsRows = []
      rideDrafts.forEach((r, i) => {
        if (r.status !== 'completed') return
        const spanMs = r.completedAt - r.startedAt
        for (let p = 0; p < GPS_PER_RIDE; p++) {
          const frac = GPS_PER_RIDE === 1 ? 0.5 : p / (GPS_PER_RIDE - 1)
          const lng = jitter(r.originLng + (r.destLng - r.originLng) * frac, 0.002)
          const lat = jitter(r.originLat + (r.destLat - r.originLat) * frac, 0.002)
          gpsRows.push({
            rideId: rideIds[i], driverId: r.driverId, sessionId: r.sessionId, lng, lat,
            heading: Math.floor(Math.random() * 360), speedKmph: Math.round(randRange(20, 60) * 100) / 100,
            accuracyMetres: Math.round(randRange(3, 15) * 10) / 10,
            recordedAt: new Date(r.startedAt.getTime() + spanMs * frac),
          })
        }
      })
      await insertGpsTracks(client, gpsRows)
      gpsRowsDone += gpsRows.length
    }

    ridesDone += batchSize
    const elapsedSec = (Date.now() - startTime) / 1000
    console.log(`  ${ridesDone}/${NUM_RIDES} rides (${(ridesDone / elapsedSec).toFixed(0)} rides/sec, ${elapsedSec.toFixed(0)}s elapsed)`)
  }

  console.log(`\nDone in ${((Date.now() - startTime) / 1000).toFixed(0)}s.`)
  console.log(`  rides:               ${ridesDone}`)
  console.log(`  ride_status_history: ${statusRowsDone}`)
  console.log(`  fare_snapshots:      ${fareRowsDone}`)
  console.log(`  payments:            ${paymentRowsDone}`)
  if (GPS_PER_RIDE > 0) console.log(`  gps_tracks:          ${gpsRowsDone}`)
  console.log(`\nCleanup: node generate-bulk-ride-history.js --cleanup\nOr manually:\n${CLEANUP_SQL}`)

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
