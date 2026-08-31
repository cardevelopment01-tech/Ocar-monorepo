// load-tests/k6/smoke.js
//
// Run this FIRST, alone, before ever running main.js — and definitely
// before running anything with the client watching. 1 VU, 1 iteration,
// exercises every code path main.js uses (auth headers, booking flow, and
// the hand-rolled Socket.io handshake) so a protocol mistake or a bad env
// var shows up as one clear failure here, not as a wall of errors during a
// 6,000-connection run in front of the client.
//
// Usage:
//   BASE_URL=https://staging.ocar.example.com WS_URL=wss://staging.ocar.example.com \
//   CATEGORY_ID=1 CITY_ID=1 \
//   k6 run --vus 1 --iterations 1 smoke.js

import http from 'k6/http'
import { check, sleep } from 'k6'
import { connect as sioConnect } from './lib/socketio.js'

const tokens = JSON.parse(open('./tokens.json'))
const BASE_URL = __ENV.BASE_URL || 'https://staging.ocar.example.com'
const WS_URL = (__ENV.WS_URL || BASE_URL.replace(/^http/, 'ws')) + '/socket.io/?EIO=4&transport=websocket'
const CATEGORY_ID = __ENV.CATEGORY_ID || '1'
const CITY_ID = __ENV.CITY_ID || '1'

export const options = { vus: 1, iterations: 1 }

export default function () {
  if (!tokens.users.length || !tokens.drivers.length) {
    throw new Error('tokens.json has no users/drivers — run seed/generate-test-tokens.js first')
  }

  const user = tokens.users[0]
  const driver = tokens.drivers[0]
  const userOpts = { headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' } }
  const driverOpts = { headers: { Authorization: `Bearer ${driver.token}`, 'Content-Type': 'application/json' } }

  console.log('--- 1. Plain HTTP reachability ---')
  const cities = http.get(`${BASE_URL}/api/v1/geo/cities`)
  check(cities, { 'geo/cities 200': (r) => r.status === 200 })

  console.log('--- 2. Fare estimate (authenticated) ---')
  const est = http.post(
    `${BASE_URL}/api/v1/pricing/estimate`,
    JSON.stringify({ category_id: Number(CATEGORY_ID), ride_type: 'one_way', distance_km: 28, duration_min: 45, city_id: Number(CITY_ID) }),
    userOpts
  )
  check(est, { 'fare estimate 200': (r) => r.status === 200 })
  if (est.status !== 200) console.error('estimate body: ' + est.body)

  console.log('--- 3. Create + cancel a real booking ---')
  const book = http.post(
    `${BASE_URL}/api/v1/rides`,
    JSON.stringify({
      categoryId: Number(CATEGORY_ID), rideType: 'one_way',
      originLat: 20.2961, originLng: 85.8245, originAddress: 'Smoke test pickup',
      destinationLat: 20.4625, destinationLng: 85.8830, destinationAddress: 'Smoke test drop',
      originCityId: Number(CITY_ID), distanceKm: 28, durationMin: 45, paymentChannel: 'cash',
    }),
    userOpts
  )
  check(book, { 'create booking 201': (r) => r.status === 201 })
  if (book.status !== 201) { console.error('booking body: ' + book.body) }
  else {
    const rideId = book.json('rideId')
    const cancel = http.post(`${BASE_URL}/api/v1/rides/${rideId}/cancel`, JSON.stringify({ reasonCode: 'load_test', reason: 'smoke test' }), userOpts)
    check(cancel, { 'cancel 200': (r) => r.status === 200 })
  }

  console.log('--- 4. Driver go-online (checks daily_verifications seeding worked) ---')
  const online = http.post(
    `${BASE_URL}/api/v1/rides/sessions/online`,
    JSON.stringify({ mode: 'standard', vehicleId: Number(driver.vehicleId), categoryId: Number(driver.categoryId), lat: 20.2961, lng: 85.8245 }),
    driverOpts
  )
  check(online, { 'go online 200': (r) => r.status === 200 })
  if (online.status !== 200) {
    console.error('go-online body: ' + online.body + ' -- if this is DAILY_CHECK_REQUIRED (428), re-run generate-test-tokens.js; if CITY_NOT_ASSIGNED, this driver needs city_id set.')
  }
  const sessionId = online.status === 200 ? online.json('id') : null

  console.log('--- 5. Socket.io handshake + one GPS ping ---')
  let sawAck = false
  sioConnect(
    WS_URL,
    driver.token,
    function (conn) {
      sawAck = true
      if (sessionId) {
        conn.emit('location:update', { sessionId: String(sessionId), lat: 20.2961, lng: 85.8245, heading: 90, speed: 8, recordedAt: new Date().toISOString() })
      }
      conn.raw.setTimeout(function () { conn.close() }, 2000)
    },
    function (err) { console.error('SOCKET.IO HANDSHAKE FAILED: ' + err) }
  )
  sleep(3)
  check(null, { 'socket.io connect ack received': () => sawAck })

  http.post(`${BASE_URL}/api/v1/rides/sessions/offline`, JSON.stringify({ reason: 'smoke_test' }), driverOpts)

  console.log('--- smoke test done — check for any failed checks above before running main.js at scale ---')
}
