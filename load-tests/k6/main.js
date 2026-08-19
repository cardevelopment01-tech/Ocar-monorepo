// load-tests/k6/main.js
//
// Pre-campaign load test for the 2026-08-04 production-scale-readiness
// report (docs/architecture/2026-08-04-production-scale-readiness-report.md).
// Simulates the report's own stated numbers, not round guesses:
//   - 5,000-6,000 concurrent users, mostly open Socket.io connections (§1)
//   - GPS pings every 3-5s per active ride, the dominant background load (§1)
//   - 1,000-2,000 rides/day -> a trivial write rate, a few bookings/minute (§1)
// Three scenarios run concurrently in one `k6 run`, matching how real traffic
// overlaps (bookings happen WHILE thousands of sockets are already open):
//
//   booking_flow   HTTP, constant-arrival-rate — fare estimate -> create ride
//                  -> read -> cancel. Sized to the report's 1-2k rides/day,
//                  scaled up modestly for peak-minute bursts, not steady 24h rate.
//   live_tracking  WebSocket (Socket.io), ramping-vus — simulates ACTIVE
//                  DRIVERS: go online over REST, then emit location:update
//                  every 3-5s over the socket (the same path the driver app
//                  itself uses — see socket.server.ts's location:update
//                  handler comment), for the length of a "shift".
//   rider_watch    WebSocket (Socket.io), ramping-vus — simulates RIDERS/
//                  idle-app-open users: connect and hold, mostly idle,
//                  responding only to Engine.IO pings. This is what actually
//                  drives the "5-6k concurrent" figure per report §1/§5,
//                  not booking volume.
//
// WHAT THIS DOES *NOT* CLAIM TO TEST:
// live_tracking/rider_watch connections are NOT paired to real ride rooms
// (that would require a full accept/OTP/tracking handshake per connection,
// which turns this into a much more fragile script for marginal realism
// gain). This test proves the server + Redis pub/sub + ALB can sustain N
// concurrent authenticated Socket.io connections and the GPS-ping event
// rate — which is what report §5 names as the actual bottleneck ("not app
// CPU — it's Redis pub/sub fan-out and Neon's connection pool"). Booking
// correctness under load is covered separately by booking_flow.
//
// PREREQUISITES — see ../README.md. In short:
//   1. Staging environment must exist and be pointed at by BASE_URL/WS_URL.
//   2. Run ../seed/generate-test-tokens.js against staging first, produces
//      ./tokens.json that this script reads.
//   3. Run smoke.js first (1 VU, both transports) to catch protocol/env
//      mistakes in private before running this live with the client.
//
// Usage:
//   BASE_URL=https://staging.ocar.example.com \
//   WS_URL=wss://staging.ocar.example.com \
//   CATEGORY_ID=1 CITY_ID=1 \
//   k6 run main.js
//
// Start SMALL and step up — don't go straight to 6,000. See README's ramp plan.

import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Counter, Trend } from 'k6/metrics'
import { connect as sioConnect } from './lib/socketio.js'

const tokens = JSON.parse(open('./tokens.json'))

const BASE_URL = __ENV.BASE_URL || 'https://staging.ocar.example.com'
const WS_URL = (__ENV.WS_URL || BASE_URL.replace(/^http/, 'ws')) + '/socket.io/?EIO=4&transport=websocket'
const CATEGORY_ID = __ENV.CATEGORY_ID || '1'
const CITY_ID = __ENV.CITY_ID || '1'
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || ''

// Bhubaneswar <-> Cuttack corridor — matches the real Odisha service area
// (CLAUDE.md: Bhubaneswar / Cuttack / Puri), not arbitrary coordinates.
const BBSR = { lat: 20.2961, lng: 85.8245 }
const CTC = { lat: 20.4625, lng: 85.8830 }

const gpsPingLatency = new Trend('gps_ping_latency_ms')
const socketConnectFailures = new Counter('socket_connect_failures')
const bookingFailures = new Counter('booking_failures')
const adminDashboardFailures = new Counter('admin_dashboard_failures')

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
}

function randOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function jitter(base, spread) {
  return base + (Math.random() - 0.5) * spread
}

export const options = {
  scenarios: {
    booking_flow: {
      executor: 'constant-arrival-rate',
      // 1-2k rides/day is ~1-1.5/min on average — this rate is deliberately
      // a peak-minute burst multiplier on top of that, not the 24h average.
      // Tune via BOOKING_RATE; report's own ask was "booking bursts", i.e.
      // clustered, not steady.
      rate: Number(__ENV.BOOKING_RATE || 20), // iterations per timeUnit
      timeUnit: '1m',
      duration: __ENV.BOOKING_DURATION || '20m',
      preAllocatedVUs: 30,
      maxVUs: 100,
      exec: 'bookingFlow',
    },
    live_tracking: {
      executor: 'ramping-vus',
      exec: 'driverGpsPing',
      startVUs: 0,
      stages: rampStages(Number(__ENV.MAX_DRIVERS || 400)),
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
    rider_watch: {
      executor: 'ramping-vus',
      exec: 'riderIdleWatch',
      startVUs: 0,
      stages: rampStages(Number(__ENV.MAX_RIDERS || 5000)),
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
    admin_dashboard: {
      // An ops admin with the dashboard open, polling read endpoints WHILE the
      // booking/live-tracking write load runs — the concurrent read+write case
      // README §7 only ever tested in isolation. Needs an ADMIN_TOKEN (a real
      // admin JWT); if it's absent the exec no-ops so main.js still runs for
      // anyone who only seeded user/driver tokens.
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.ADMIN_POLL_RATE || 30), // dashboard polls per minute
      timeUnit: '1m',
      duration: __ENV.BOOKING_DURATION || '20m',
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'adminDashboardPoll',
    },
  },
  thresholds: {
    // p95 < 500ms mirrors the report's own secondary autoscaling trigger
    // (§4: "scale out on ... p95 latency > 500ms") — if this breaches during
    // the test, that's the same signal the ASG would act on in production.
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    socket_connect_failures: ['count<50'],
    gps_ping_latency_ms: ['p(95)<500'],
    admin_dashboard_failures: ['count<20'],
  },
}

// Ramps 0 -> target over 5m, holds for the bulk of the run, ramps down over
// 2m. Keep this shape for every ramping-vus scenario so socket_connect
// storms don't happen simultaneously across scenarios.
function rampStages(target) {
  return [
    { duration: '5m', target },
    { duration: __ENV.HOLD_DURATION || '15m', target },
    { duration: '2m', target: 0 },
  ]
}

// ── booking_flow ──────────────────────────────────────────────────────────

export function bookingFlow() {
  const user = randOf(tokens.users)
  const opts = authHeaders(user.token)

  group('booking_flow', function () {
    const distanceKm = 28 // approx Bhubaneswar -> Cuttack
    const estimateRes = http.post(
      `${BASE_URL}/api/v1/pricing/estimate`,
      JSON.stringify({
        category_id: Number(CATEGORY_ID),
        ride_type: 'one_way',
        distance_km: distanceKm,
        duration_min: 45,
        city_id: Number(CITY_ID),
      }),
      opts
    )
    const estimateOk = check(estimateRes, { 'fare estimate 200': (r) => r.status === 200 })
    if (!estimateOk) { bookingFailures.add(1); return }

    const bookRes = http.post(
      `${BASE_URL}/api/v1/rides`,
      JSON.stringify({
        categoryId: Number(CATEGORY_ID),
        rideType: 'one_way',
        originLat: jitter(BBSR.lat, 0.02),
        originLng: jitter(BBSR.lng, 0.02),
        originAddress: 'Load test pickup',
        destinationLat: jitter(CTC.lat, 0.02),
        destinationLng: jitter(CTC.lng, 0.02),
        destinationAddress: 'Load test drop',
        originCityId: Number(CITY_ID),
        distanceKm,
        durationMin: 45,
        paymentChannel: 'cash',
      }),
      opts
    )
    const bookOk = check(bookRes, { 'create booking 201': (r) => r.status === 201 })
    if (!bookOk) { bookingFailures.add(1); return }

    const rideId = bookRes.json('id')

    sleep(1) // roughly how long a rider looks at the confirmation screen

    const getRes = http.get(`${BASE_URL}/api/v1/rides/${rideId}`, opts)
    check(getRes, { 'get ride 200': (r) => r.status === 200 })

    // Cancel to avoid leaving thousands of permanently-unmatched 'requested'
    // rides in staging after every run.
    const cancelRes = http.post(
      `${BASE_URL}/api/v1/rides/${rideId}/cancel`,
      JSON.stringify({ reasonCode: 'load_test', reason: 'k6 load test cleanup' }),
      opts
    )
    check(cancelRes, { 'cancel 200': (r) => r.status === 200 })
  })
}

// ── live_tracking (drivers) ─────────────────────────────────────────────

export function driverGpsPing() {
  if (tokens.drivers.length === 0) {
    console.error('no driver tokens in tokens.json — see seed script warning about active-driver count on staging')
    sleep(5)
    return
  }
  const driver = randOf(tokens.drivers)
  const opts = authHeaders(driver.token)

  // Real driver flow: go online over REST first (this is the same call the
  // driver app makes when a driver taps "Go Online") to get a sessionId,
  // THEN start pinging location over the socket.
  const onlineRes = http.post(
    `${BASE_URL}/api/v1/rides/sessions/online`,
    JSON.stringify({
      mode: 'standard',
      vehicleId: Number(driver.vehicleId),
      categoryId: Number(driver.categoryId),
      lat: jitter(BBSR.lat, 0.05),
      lng: jitter(BBSR.lng, 0.05),
    }),
    opts
  )
  if (!check(onlineRes, { 'go online 200': (r) => r.status === 200 })) {
    bookingFailures.add(1)
    sleep(5)
    return
  }
  const sessionId = onlineRes.json('id')

  let lat = jitter(BBSR.lat, 0.05)
  let lng = jitter(BBSR.lng, 0.05)

  sioConnect(
    WS_URL,
    driver.token,
    function (conn) {
      const interval = conn.raw.setInterval(function () {
        // small random walk, not a teleporting driver
        lat += (Math.random() - 0.5) * 0.002
        lng += (Math.random() - 0.5) * 0.002
        const t0 = Date.now()
        conn.emit('location:update', {
          sessionId: String(sessionId),
          lat,
          lng,
          heading: Math.floor(Math.random() * 360),
          speed: Math.random() * 15,
          recordedAt: new Date().toISOString(),
        })
        gpsPingLatency.add(Date.now() - t0) // fire-and-forget event, so this
        // measures emit-call overhead, not a server ack — see README for how
        // ping->broadcast latency is verified instead (Grafana/Tempo trace).
      }, jitter(4000, 2000)) // 3-5s per report §1

      // Hold the connection for a "shift" - the ramp's HOLD_DURATION - then
      // clean up. gracefulRampDown on the executor also allows this to close
      // naturally when the scenario winds down.
      conn.raw.setTimeout(function () {
        conn.raw.clearInterval(interval)
        conn.close()
      }, durationToMs(__ENV.HOLD_DURATION || '15m'))
    },
    function (err) {
      socketConnectFailures.add(1)
      console.error('driver socket error: ' + err)
    }
  )

  // Best-effort cleanup so staging doesn't accumulate drivers stuck 'online'.
  http.post(`${BASE_URL}/api/v1/rides/sessions/offline`, JSON.stringify({ reason: 'load_test_complete' }), opts)
}

// ── rider_watch (idle riders) ────────────────────────────────────────────

export function riderIdleWatch() {
  const user = randOf(tokens.users)

  sioConnect(
    WS_URL,
    user.token,
    function (conn) {
      // Mostly idle - matches report §2's "idle sockets between GPS pings"
      // characterization of the bulk of the 5-6k concurrent figure. Just
      // holds the connection open (auto-ponging Engine.IO pings) for the
      // hold duration.
      conn.raw.setTimeout(function () {
        conn.close()
      }, durationToMs(__ENV.HOLD_DURATION || '15m'))
    },
    function (err) {
      socketConnectFailures.add(1)
      console.error('rider socket error: ' + err)
    }
  )
}

// ── admin_dashboard (ops reads during the write load) ────────────────────
// Polls the real admin read endpoints (admin.routes.ts, mounted at /api/v1/admin)
// that back the ops dashboard: ride stats, the rides list, the active-sessions
// live map, and one driver's ride history. These are the analytics-style reads
// README §7 says to run against seeded volume — here they run CONCURRENTLY with
// booking_flow/live_tracking so their query plans compete with the write load.
export function adminDashboardPoll() {
  if (!ADMIN_TOKEN) {
    // No admin token seeded — skip cleanly so the other three scenarios run.
    return
  }
  const opts = { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }

  // Unlike bookingFlow (which bails early after each step because the next
  // step depends on the prior one's output, e.g. rideId), these 4 reads are
  // independent with no shared state — continuing after one fails so the
  // rest still get exercised is deliberate, not a missed early-return.
  group('admin_dashboard', function () {
    const stats = http.get(`${BASE_URL}/api/v1/admin/rides/stats`, opts)
    if (!check(stats, { 'admin ride stats 200': (r) => r.status === 200 })) adminDashboardFailures.add(1)

    const list = http.get(`${BASE_URL}/api/v1/admin/rides?limit=20`, opts)
    if (!check(list, { 'admin rides list 200': (r) => r.status === 200 })) adminDashboardFailures.add(1)

    // Active sessions = the live-map data source (getAdminActiveSessions).
    const sessions = http.get(`${BASE_URL}/api/v1/admin/sessions/active`, opts)
    if (!check(sessions, { 'admin active sessions 200': (r) => r.status === 200 })) adminDashboardFailures.add(1)

    // Driver ride history for one real driver from the token pool.
    if (tokens.drivers.length > 0) {
      const driverId = randOf(tokens.drivers).id
      const history = http.get(`${BASE_URL}/api/v1/admin/drivers/${driverId}/rides`, opts)
      if (!check(history, { 'admin driver history 200': (r) => r.status === 200 })) adminDashboardFailures.add(1)
    }
  })
}

function durationToMs(d) {
  const m = /^(\d+)(s|m|h)$/.exec(d)
  if (!m) return 15 * 60 * 1000
  const n = Number(m[1])
  return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60 * 1000 : n * 60 * 60 * 1000
}
