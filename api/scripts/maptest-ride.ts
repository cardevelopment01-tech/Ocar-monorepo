// Test-only (never committed): book / accept / progress a ride for the review-account rider, with the seeded drivers.
//   tsx scripts/maptest-ride.ts book            -> a ride in 'requested' (the searching screen)
//   tsx scripts/maptest-ride.ts accept <rideId> [driverIndex]   -> a seeded driver accepts it (the assigned car)
import fs from 'fs'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { createApp } from '@/app'
import { loginUser } from '../tests/helpers/fixtures/rides.fixture'

const RIDER_PHONE = process.env['REVIEW_PHONE'] ?? '+919700000811'
const base = 'http://localhost:4000'
const [, , action, arg1, arg2] = process.argv

async function main() {
  const app = createApp()
  const state = JSON.parse(fs.readFileSync('scripts/maptest-state.json', 'utf8')) as Array<{ accessToken: string; categoryId: number; phone: string }>
  if (action === 'book') {
    const { accessToken } = await loginUser(app, redis, RIDER_PHONE)
    const res = await fetch(base + '/api/v1/rides', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({
        categoryId: state[0]!.categoryId, rideType: 'one_way', paymentChannel: 'cash',
        originLat: 20.2961, originLng: 85.8245, originAddress: 'Kalinga Vihar, Bhubaneswar',
        destinationLat: 20.4625, destinationLng: 85.8830, destinationAddress: 'Cuttack',
        distanceKm: 28, durationMin: 45,
      }),
    })
    console.log('book', res.status, (await res.text()).slice(0, 300))
  } else if (action === 'accept') {
    const d = state[Number(arg2 ?? 0)]!
    const res = await fetch(`${base}/api/v1/rides/${arg1}/accept`, { method: 'POST', headers: { authorization: 'Bearer ' + d.accessToken } })
    console.log('accept by', d.phone, res.status, (await res.text()).slice(0, 300))
  } else {
    console.log('usage: book | accept <rideId> [driverIndex]')
  }
  await pool.end(); redis.disconnect()
}
void main()
