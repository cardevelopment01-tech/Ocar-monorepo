// load-tests/k6/spike.js
//
// SPIKE test — the gap main.js's 5-minute ramps don't cover: an instant 0->N
// surge, to measure ASG reaction time and post-spike RECOVERY (does latency
// return to baseline once the spike passes, or does the system stay degraded).
// Spike testing per Grafana k6's own guidance is about recovery, not sustained
// capacity — that's what main.js's soak-shaped ramps already prove.
//
// Two scenarios, fired together:
//   booking_spike  HTTP, ramping-arrival-rate — jumps 0 -> SPIKE_RATE/min in
//                  10s, holds 2m, drops to a low baseline and holds 3m so you
//                  can watch recovery (latency should fall back, not stay high).
//   rider_spike    Socket.io, ramping-vus — jumps 0 -> SPIKE_RIDERS in 10s
//                  (a connection storm — the harder thing for Redis pub/sub
//                  fan-out + the ALB to absorb), holds 2m, drops.
//
// Thresholds are deliberately LOOSER on latency than main.js (p95<1500 vs 500):
// a spike is allowed to hurt briefly; what must hold is that it does not error
// out (http_req_failed) or fail to accept connections, and that it recovers.
//
// PREREQUISITES — same as main.js (see ../README.md): staging up, tokens.json
// seeded, smoke.js green. Run this AFTER a clean main.js step, not as the first
// thing against staging. Start with a small SPIKE_RATE/SPIKE_RIDERS and step up.
//
// Usage:
//   BASE_URL=https://staging.ocar.example.com \
//   WS_URL=wss://staging.ocar.example.com \
//   CATEGORY_ID=1 CITY_ID=1 \
//   SPIKE_RATE=300 SPIKE_RIDERS=2000 \
//   k6 run spike.js

import http from 'k6/http'
import { check, group } from 'k6'
import { Counter } from 'k6/metrics'
import { connect as sioConnect } from './lib/socketio.js'

const tokens = JSON.parse(open('./tokens.json'))

const BASE_URL = __ENV.BASE_URL || 'https://staging.ocar.example.com'
const WS_URL = (__ENV.WS_URL || BASE_URL.replace(/^http/, 'ws')) + '/socket.io/?EIO=4&transport=websocket'
const CATEGORY_ID = __ENV.CATEGORY_ID || '1'
const CITY_ID = __ENV.CITY_ID || '1'

const SPIKE_RATE = Number(__ENV.SPIKE_RATE || 300)     // bookings/min at the peak of the spike
const SPIKE_RIDERS = Number(__ENV.SPIKE_RIDERS || 2000) // concurrent sockets slammed on in 10s

// Same Bhubaneswar <-> Cuttack corridor as main.js — not arbitrary coordinates.
const BBSR = { lat: 20.2961, lng: 85.8245 }
const CTC = { lat: 20.4625, lng: 85.8830 }

const socketConnectFailures = new Counter('socket_connect_failures')
const bookingFailures = new Counter('booking_failures')

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
    booking_spike: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1m',
      startRate: 0,
      preAllocatedVUs: 100,
      // ~2x preAllocated/max headroom over SPIKE_RATE: a degraded/slow moment
      // (thresholds tolerate p95 up to 1500ms) is exactly what this test needs
      // to observe accurately — a tight VU margin would instead silently drop
      // iterations to VU exhaustion and understate the real failure rate.
      maxVUs: 600,
      exec: 'bookingFlow',
      stages: [
        { duration: '10s', target: SPIKE_RATE }, // instant surge
        { duration: '2m', target: SPIKE_RATE }, // hold the peak
        { duration: '10s', target: 10 }, // drop hard
        { duration: '3m', target: 10 }, // recovery observation window
      ],
    },
    rider_spike: {
      executor: 'ramping-vus',
      exec: 'riderIdleWatch',
      startVUs: 0,
      stages: [
        { duration: '10s', target: SPIKE_RIDERS }, // connection storm
        { duration: '2m', target: SPIKE_RIDERS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Looser than main.js on purpose — a spike may hurt latency briefly. What
    // must hold: it doesn't error out and it accepts the connection storm.
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.05'],
    socket_connect_failures: ['count<100'],
  },
}

// ── booking_spike ─────────────────────────────────────────────────────────

export function bookingFlow() {
  const user = randOf(tokens.users)
  const opts = authHeaders(user.token)

  group('booking_spike', function () {
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
    const estimateOk = check(estimateRes, { 'spike: estimate 200': (r) => r.status === 200 })
    if (!estimateOk) { bookingFailures.add(1); return }

    const bookRes = http.post(
      `${BASE_URL}/api/v1/rides`,
      JSON.stringify({
        categoryId: Number(CATEGORY_ID),
        rideType: 'one_way',
        originLat: jitter(BBSR.lat, 0.02),
        originLng: jitter(BBSR.lng, 0.02),
        originAddress: 'Spike test pickup',
        destinationLat: jitter(CTC.lat, 0.02),
        destinationLng: jitter(CTC.lng, 0.02),
        destinationAddress: 'Spike test drop',
        originCityId: Number(CITY_ID),
        distanceKm,
        durationMin: 45,
        paymentChannel: 'cash',
      }),
      opts
    )
    const bookOk = check(bookRes, { 'spike: create booking 201': (r) => r.status === 201 })
    if (!bookOk) { bookingFailures.add(1); return }

    // Cancel so a spike doesn't leave thousands of unmatched 'requested' rides.
    const rideId = bookRes.json('id')
    const cancelRes = http.post(
      `${BASE_URL}/api/v1/rides/${rideId}/cancel`,
      JSON.stringify({ reasonCode: 'load_test', reason: 'spike cleanup' }),
      opts
    )
    check(cancelRes, { 'spike: cancel 200': (r) => r.status === 200 })
  })
}

// ── rider_spike (connection storm) ──────────────────────────────────────

export function riderIdleWatch() {
  const user = randOf(tokens.users)

  sioConnect(
    WS_URL,
    user.token,
    function (conn) {
      // Hold ~2.5m so the connection survives the peak-hold stage, then close.
      conn.raw.setTimeout(function () {
        conn.close()
      }, 150000)
    },
    function (err) {
      socketConnectFailures.add(1)
      console.error('spike rider socket error: ' + err)
    }
  )
}
