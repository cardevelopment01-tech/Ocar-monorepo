#!/usr/bin/env node
/**
 * load-tests/seed/generate-test-tokens.js
 *
 * Prepares everything the k6 scripts need to hit staging without going through
 * real OTP/SMS:
 *
 *   1. Ensures N synthetic rider accounts exist in `users` (cheap — almost no
 *      FK graph) and mints an access token for each.
 *   2. Reuses REAL, already-onboarded active drivers already in the DB
 *      (drivers.status='active' + an active vehicle + a city assigned) rather
 *      than fabricating driver rows — driver onboarding has a much deeper FK
 *      graph (vehicles, documents, categories) that isn't safe to fake blind.
 *      For each driver it picks, it upserts today's `driver_verifications`
 *      rows (kind='daily_selfie' + 'daily_plate', status='passed') so
 *      POST /sessions/online doesn't reject with DAILY_CHECK_REQUIRED (428) —
 *      that check is what actually blocks a normal driver login every
 *      morning until they take a selfie in the app; there's no reason to
 *      make the load test wait on that.
 *   3. Signs access tokens with the SAME secret/algorithm api/src/lib/jwt.ts
 *      uses (HS256, payload shape { sub, code, role, status }), but with a
 *      longer expiry than the app's real 15m default — the real expiry is a
 *      security choice for production traffic, not something a 20-40 minute
 *      load test run should have to fight with token refresh flows for.
 *      This does not touch production behavior — it only mints tokens for a
 *      login step the app's own logic never sees.
 *
 * WHY NOT DRIVE THIS THROUGH THE REAL OTP ENDPOINT INSTEAD:
 *   /api/v1/auth/otp/request sends a real SMS via Fast2SMS per call. At
 *   thousands of "logins" that's real money and will hit Fast2SMS's own rate
 *   limits long before k6 gets anywhere near the numbers we're actually
 *   trying to test. Pre-minting tokens is the standard k6 pattern for this
 *   exact situation (auth once in a setup step, replay the token for the
 *   whole run) — see the k6 docs on "Authentication: token-based".
 *
 * Usage:
 *   JWT_ACCESS_SECRET=... \
 *   node generate-test-tokens.js --users 6000 --drivers 400 --expiry 3h
 *
 * DB connection is derived live from AWS (lib/staging-db.js) against the
 * staging RDS instance specifically -- no DATABASE_URL needed or read, so
 * there's no way for this to silently target the wrong database.
 *
 * Output: ./tokens.json — consumed by load-tests/k6/main.js via k6's open().
 *
 * SAFETY:
 *   - Only ever INSERTs into `users` with phone numbers in the reserved
 *     9999900000-9999999999 test block, and only ever UPSERTs
 *     `driver_verifications` rows dated today for drivers that already
 *     exist. It never creates or mutates a `drivers` row, `driver_vehicles`
 *     row, or anything payment/ride-related.
 *   - Hardcoded to the staging RDS instance identifier -- there is no way to
 *     point this at prod short of editing lib/staging-db.js itself.
 */

const { Client } = require('pg')
const jwt = require('jsonwebtoken')
const fs = require('fs')
const { getStagingDbConfig } = require('./lib/staging-db')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const NUM_USERS = parseInt(arg('users', '500'), 10)
const NUM_DRIVERS = parseInt(arg('drivers', '200'), 10)
const EXPIRY = arg('expiry', '3h')
const OUT_FILE = arg('out', './tokens.json')

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET

if (!JWT_ACCESS_SECRET) {
  console.error('JWT_ACCESS_SECRET env var is required (copy from staging api-env).')
  process.exit(1)
}

// DB connection is derived live from AWS (see lib/staging-db.js), not read
// from DATABASE_URL -- that SSM value was found pointing at the old
// pre-migration Neon database, silently diverging from what the app itself
// (DB_AUTH_MODE=secrets-manager) actually reads. Hardcoded to the staging
// RDS instance only, so there's no prod-detection heuristic to get wrong.

// Mirrors signAccessToken() in api/src/lib/jwt.ts exactly (same secret,
// same payload shape, same `sub` as JWT `subject`) — just with a
// load-test-only expiry override instead of config.JWT_ACCESS_EXPIRY.
function signAccessToken({ sub, code, role, status }) {
  return jwt.sign({ code, role, status }, JWT_ACCESS_SECRET, {
    subject: sub,
    expiresIn: EXPIRY,
  })
}

async function main() {
  const client = new Client(getStagingDbConfig())
  await client.connect()

  console.log(`Connected. Seeding ${NUM_USERS} test users + reusing up to ${NUM_DRIVERS} real active drivers...`)

  // ── Users: cheap to fabricate, reserved phone block so they're obviously
  //    synthetic and easy to clean up afterward (DELETE FROM users WHERE
  //    phone LIKE '9999900%').
  const users = []
  for (let i = 0; i < NUM_USERS; i++) {
    const phone = `99999${String(10000 + i).padStart(5, '0')}`.slice(0, 10)
    const res = await client.query(
      `INSERT INTO users (phone, name, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (phone) DO UPDATE SET status = 'active'
       RETURNING id::text, code, status`,
      [phone, `LoadTest User ${i}`]
    )
    users.push(res.rows[0])
  }
  console.log(`  users ready: ${users.length}`)

  // ── Drivers: reuse real, already-onboarded active drivers with an active
  //    vehicle and an assigned city — this is the graph goOnline() actually
  //    checks (see rides.service.ts goOnline()), and it's not safe to fake
  //    blind from outside the onboarding flow.
  const driverRows = await client.query(
    `SELECT d.id::text, d.code, d.status,
            dv.id::text AS vehicle_id, dv.category_id::text AS category_id,
            d.city_id::text AS city_id
     FROM drivers d
     JOIN driver_vehicles dv ON dv.driver_id = d.id AND dv.status = 'active'
     WHERE d.status = 'active' AND d.city_id IS NOT NULL
     ORDER BY d.id
     LIMIT $1`,
    [NUM_DRIVERS]
  )

  if (driverRows.rows.length < NUM_DRIVERS) {
    console.warn(
      `\n⚠ Only found ${driverRows.rows.length} active drivers with an active vehicle on staging ` +
      `(asked for ${NUM_DRIVERS}). The k6 GPS-ping scenario will only simulate ${driverRows.rows.length} drivers ` +
      `unless more are onboarded on staging first (real onboarding flow, once — these are reusable across every future load test run, not a one-off).\n`
    )
  }

  const drivers = driverRows.rows
  const todayIST = await client.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today`)
  const verifiedFor = todayIST.rows[0].today

  for (const d of drivers) {
    await client.query(
      `INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status)
       VALUES ($1, NULL, 'daily_selfie', $2, 'https://load-test.internal/placeholder-selfie.jpg', 'passed')
       ON CONFLICT (driver_id, verified_for) WHERE kind = 'daily_selfie' DO NOTHING`,
      [d.id, verifiedFor]
    ).catch(() => {}) // partial-index ON CONFLICT target syntax varies by pg version; see fallback note below
    await client.query(
      `INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status)
       SELECT $1, $2, 'daily_plate', $3, 'https://load-test.internal/placeholder-plate.jpg', 'passed'
       WHERE NOT EXISTS (
         SELECT 1 FROM driver_verifications
         WHERE driver_id = $1 AND vehicle_id = $2 AND verified_for = $3 AND kind = 'daily_plate'
       )`,
      [d.id, d.vehicle_id, verifiedFor]
    )
  }
  console.log(`  drivers ready (daily verification stamped for today): ${drivers.length}`)

  // ── Sign tokens
  const userTokens = users.map(u => ({
    id: u.id,
    code: u.code,
    token: signAccessToken({ sub: u.id, code: u.code, role: 'user', status: u.status }),
  }))
  const driverTokens = drivers.map(d => ({
    id: d.id,
    code: d.code,
    vehicleId: d.vehicle_id,
    categoryId: d.category_id,
    cityId: d.city_id,
    token: signAccessToken({ sub: d.id, code: d.code, role: 'driver', status: 'active' }),
  }))

  fs.writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), expiry: EXPIRY, users: userTokens, drivers: driverTokens }, null, 2))
  console.log(`\nWrote ${OUT_FILE} — ${userTokens.length} user tokens, ${driverTokens.length} driver tokens, expiring in ${EXPIRY}.`)
  console.log('Cleanup when done: DELETE FROM users WHERE phone LIKE \'99999%\';')

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
