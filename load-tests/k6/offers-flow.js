// load-tests/k6/offers-flow.js
//
// Offers happy path + the two guard rails, one rider per VU. Needs offers_enabled='true' and an active code offer
// (OFFER_CODE) on the target environment; when offers are off the script only checks that preview says so.
//
//   preview with the code  -> payable = fare - discount
//   book with the code     -> 201, then cancel (releases the reservation: no budget leaks across iterations)
//   book with a wrong expectedPayable -> 409 PRICE_CHANGED carrying the real payable (never silently re-priced)
//
// Usage:
//   BASE_URL=https://staging... CATEGORY_ID=1 CITY_ID=1 OFFER_CODE=SAVE50 \
//   k6 run --vus 5 --duration 1m offers-flow.js

import http from 'k6/http'
import { check, sleep } from 'k6'

const tokens = JSON.parse(open('./tokens.json'))
const BASE_URL = __ENV.BASE_URL || 'https://staging.ocar.example.com'
const CATEGORY_ID = Number(__ENV.CATEGORY_ID || '1')
const CITY_ID = Number(__ENV.CITY_ID || '1')
const OFFER_CODE = __ENV.OFFER_CODE || ''

export const options = {
  thresholds: { checks: ['rate>0.99'], http_req_failed: ['rate<0.02'] },
}

const trip = {
  originLat: 20.2961, originLng: 85.8245, originAddress: 'Offers test pickup',
  destinationLat: 20.4625, destinationLng: 85.883, destinationAddress: 'Offers test drop',
  distanceKm: 28, durationMin: 45,
}

export default function () {
  const user = tokens.users[(__VU - 1) % tokens.users.length]
  const opts = { headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' } }

  const preview = http.post(
    `${BASE_URL}/api/v1/offers/preview`,
    JSON.stringify({
      category_id: CATEGORY_ID, ride_type: 'one_way', distance_km: trip.distanceKm, duration_min: trip.durationMin,
      paymentChannel: 'cash', originLat: trip.originLat, originLng: trip.originLng,
      destinationLat: trip.destinationLat, destinationLng: trip.destinationLng,
      ...(OFFER_CODE ? { code: OFFER_CODE } : {}),
    }),
    opts,
  )
  check(preview, { 'preview 200': (r) => r.status === 200 })
  if (preview.status !== 200) return
  const p = preview.json()
  if (!p.enabled || !p.applied) { sleep(1); return } // offers off, or the code does not apply here
  check(p, { 'payable = fare - discount': (x) => Math.abs(x.payable - (x.fareTotal - x.discount)) < 0.01 })

  const body = { categoryId: CATEGORY_ID, rideType: 'one_way', originCityId: CITY_ID, paymentChannel: 'cash', ...trip }

  const stale = http.post(`${BASE_URL}/api/v1/rides`, JSON.stringify({ ...body, couponCode: OFFER_CODE, expectedPayable: p.payable + 7 }), opts)
  check(stale, {
    'wrong expectedPayable -> 409 PRICE_CHANGED': (r) => r.status === 409 && r.json('code') === 'PRICE_CHANGED',
    '409 carries the real payable': (r) => r.status === 409 && Math.abs(r.json('details.payable') - p.payable) < 0.01,
  })

  const book = http.post(`${BASE_URL}/api/v1/rides`, JSON.stringify({ ...body, couponCode: OFFER_CODE, expectedPayable: p.payable }), opts)
  check(book, { 'booking with code 201': (r) => r.status === 201 })
  if (book.status === 201) {
    const cancel = http.post(`${BASE_URL}/api/v1/rides/${book.json('rideId')}/cancel`, JSON.stringify({ reasonCode: 'load_test', reason: 'offers flow' }), opts)
    check(cancel, { 'cancel 200': (r) => r.status === 200 })
  }
  sleep(1)
}
