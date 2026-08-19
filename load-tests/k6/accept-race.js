// load-tests/k6/accept-race.js
//
// Correctness test, not a capacity test: fires N drivers' POST /accept at the
// SAME ride truly concurrently (k6 http.batch, single VU, real parallel HTTP
// connections — no cross-VU timing games needed) and asserts exactly one
// wins. This is the scenario main.js's booking_flow never exercises (it only
// creates+cancels) — the actual concurrency risk in a dispatch system is the
// accept race on ride_assignments, not the booking POST.
//
// It also includes one "outsider" driver per race who is NEVER brought
// online and NEVER sent a location ping near the ride, i.e. was definitely
// not offered this ride by broadcast.processor.ts. This test guards against
// a fixed bug (commit de01ffa): POST /rides/:id/accept used to gate its
// UPDATE only on `status = 'requested'`, never on whether driver_id was
// ever offered the ride — since ride IDs are sequential bigints, that was a
// real ride-hijack path, not just theoretical. acceptAssignment() (see
// api/src/modules/rides/rides.repository.ts) now requires an offered
// ride_assignments row; if the outsider's accept call ever succeeds again,
// that guard has regressed. See README §9.
//
// Usage:
//   BASE_URL=https://staging.ocar.example.com WS_URL=wss://staging.ocar.example.com \
//   CITY_ID=1 \
//   k6 run k6/accept-race.js
//
// Requires tokens.json with at least (RACE_SIZE + 1) * ACCEPT_RACE_ITERATIONS
// drivers sharing a category (default RACE_SIZE=5, matching
// BROADCAST_MAX_DRIVERS in api/src/constants/limits.ts — no point racing more
// drivers than the server ever offers a ride to at once).

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'
import { connect as sioConnect } from './lib/socketio.js'

const tokens = JSON.parse(open('./tokens.json'))
const BASE_URL = __ENV.BASE_URL || 'https://staging.ocar.example.com'
const WS_URL = (__ENV.WS_URL || BASE_URL.replace(/^http/, 'ws')) + '/socket.io/?EIO=4&transport=websocket'
const CITY_ID = __ENV.CITY_ID || '1'
const RACE_SIZE = Number(__ENV.RACE_SIZE || 5) // BROADCAST_MAX_DRIVERS — see file header
const ITERATIONS = Number(__ENV.ACCEPT_RACE_ITERATIONS || 5)
const BROADCAST_WAIT_S = Number(__ENV.BROADCAST_WAIT_S || 6) // round-1 broadcast has delay:0 but still queues through BullMQ

const BBSR = { lat: 20.2961, lng: 85.8245 }
const CTC = { lat: 20.4625, lng: 85.8830 }

const multipleWinners = new Counter('accept_race_multiple_winners')
const noWinner = new Counter('accept_race_no_winner')
const serverErrors = new Counter('accept_race_5xx')
const unauthorizedAcceptSucceeded = new Counter('accept_race_unauthorized_accept_succeeded')

export const options = {
  vus: 1,
  iterations: ITERATIONS,
  thresholds: {
    accept_race_multiple_winners: ['count<1'],
    accept_race_no_winner: ['count<1'],
    accept_race_5xx: ['count<1'],
    // Regression guard: acceptAssignment() now requires an offered
    // ride_assignments row (fixed — see rides.repository.ts's
    // acceptAssignment, and the file header above). This threshold catches
    // if that guard ever regresses, not an open bug.
    accept_race_unauthorized_accept_succeeded: ['count<1'],
  },
}

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
}
function jitter(base, spread) { return base + (Math.random() - 0.5) * spread }

if (!tokens.drivers || !tokens.users || !tokens.users.length) {
  throw new Error('tokens.json missing users/drivers — run seed/generate-test-tokens.js first')
}
const primaryCategory = tokens.drivers[0].categoryId
const categoryPool = tokens.drivers.filter((d) => String(d.categoryId) === String(primaryCategory))
if (categoryPool.length < RACE_SIZE + 1) {
  throw new Error(
    `Need at least ${RACE_SIZE + 1} drivers sharing one category in tokens.json, found ${categoryPool.length}. ` +
    're-run generate-test-tokens.js with a higher --drivers count.'
  )
}

export default function () {
  const iter = __ITER
  const offered = []
  for (let i = 0; i < RACE_SIZE; i++) {
    offered.push(categoryPool[(iter * RACE_SIZE + i) % categoryPool.length])
  }
  // Pick an outsider from the FULL driver pool (any category), from the far
  // end so it doesn't collide with `offered` — never goes online, never
  // pings a location, so it is definitely not a broadcast recipient.
  const outsider = tokens.drivers[(tokens.drivers.length - 1 - iter) % tokens.drivers.length]

  // Bring the real offerees online near the pickup point so
  // findNearbyDrivers() (broadcast.processor.ts) actually selects them.
  for (const driver of offered) {
    const onlineRes = http.post(
      `${BASE_URL}/api/v1/rides/sessions/online`,
      JSON.stringify({
        mode: 'standard', vehicleId: Number(driver.vehicleId), categoryId: Number(driver.categoryId),
        lat: jitter(BBSR.lat, 0.01), lng: jitter(BBSR.lng, 0.01),
      }),
      authHeaders(driver.token)
    )
    if (!check(onlineRes, { 'race: driver online 200': (r) => r.status === 200 })) continue
    driver._sessionId = onlineRes.json('id')

    sioConnect(
      WS_URL, driver.token,
      (conn) => {
        conn.emit('location:update', {
          sessionId: String(driver._sessionId),
          lat: jitter(BBSR.lat, 0.01), lng: jitter(BBSR.lng, 0.01),
          heading: 0, speed: 0, recordedAt: new Date().toISOString(),
        })
        conn.raw.setTimeout(() => conn.close(), 500)
      },
      (err) => console.error('race: driver location socket failed: ' + err)
    )
  }
  sleep(1.5) // let the location:update round trip land in driver_location_snapshots

  const user = tokens.users[iter % tokens.users.length]
  const bookRes = http.post(
    `${BASE_URL}/api/v1/rides`,
    JSON.stringify({
      categoryId: Number(primaryCategory), rideType: 'one_way',
      originLat: BBSR.lat, originLng: BBSR.lng, originAddress: 'Accept-race pickup',
      destinationLat: CTC.lat, destinationLng: CTC.lng, destinationAddress: 'Accept-race drop',
      originCityId: Number(CITY_ID), distanceKm: 28, durationMin: 45, paymentChannel: 'cash',
    }),
    authHeaders(user.token)
  )
  if (!check(bookRes, { 'race: ride created 201': (r) => r.status === 201 })) return
  const rideId = bookRes.json('id')

  sleep(BROADCAST_WAIT_S) // let broadcast_ride round 1 actually run through BullMQ

  const raceDrivers = [...offered, outsider]
  const responses = http.batch(
    raceDrivers.map((driver) => ({
      method: 'POST',
      url: `${BASE_URL}/api/v1/rides/${rideId}/accept`,
      body: null,
      params: authHeaders(driver.token),
    }))
  )

  const offeredResults = responses.slice(0, offered.length)
  const outsiderResult = responses[responses.length - 1]

  const winners = offeredResults.filter((r) => r.status === 200).length
  const conflicts = offeredResults.filter((r) => r.status === 409).length
  const serverErrs = offeredResults.filter((r) => r.status >= 500).length + (outsiderResult.status >= 500 ? 1 : 0)

  check(null, {
    'race: exactly one offered driver won': () => winners === 1,
    'race: the rest got a clean 409, not a 500': () => conflicts === offered.length - winners && serverErrs === 0,
  })
  if (winners === 0) noWinner.add(1)
  if (winners > 1) multipleWinners.add(1)
  if (serverErrs > 0) serverErrors.add(serverErrs)

  if (outsiderResult.status === 200) {
    unauthorizedAcceptSucceeded.add(1)
    console.error(
      `ride ${rideId}: driver ${outsider.id} (never online, never offered this ride) won it anyway — ` +
      'accept has no ride_assignments check. See file header / README §9.'
    )
  }

  // Cleanup: cancel the ride and take offerees back offline so token reuse
  // across iterations doesn't collide with the "one active session" index.
  http.post(
    `${BASE_URL}/api/v1/rides/${rideId}/cancel`,
    JSON.stringify({ reasonCode: 'load_test', reason: 'accept-race cleanup' }),
    authHeaders(user.token)
  )
  for (const driver of offered) {
    http.post(`${BASE_URL}/api/v1/rides/sessions/offline`, JSON.stringify({ reason: 'accept_race_cleanup' }), authHeaders(driver.token))
  }
}
