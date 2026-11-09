// Test-only (never committed): a rider subscribes and then NEVER unsubscribes; the ride stops searching; the server must stop
// sending cars within the recheck interval.
import { io } from 'socket.io-client'
import { client as redis } from '@/db/redis'
import { pool } from '@/db/client'
import { createApp } from '@/app'
import { loginUser } from '../tests/helpers/fixtures/rides.fixture'

const RIDER = process.env['REVIEW_PHONE'] ?? '+919700000811'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const app = createApp()
  const rider = await loginUser(app, redis, RIDER)
  const row = await pool.query(`SELECT id::text FROM rides WHERE user_id = $1 AND status = 'requested' ORDER BY id DESC LIMIT 1`, [rider.userId])
  const rideId = row.rows[0]?.id as string
  if (!rideId) throw new Error('book a ride first')
  const socket = io('http://localhost:4000', { transports: ['websocket'], auth: { token: rider.accessToken } })
  const t0 = Date.now()
  const times: number[] = []
  socket.on('nearby:car', () => times.push(Date.now() - t0))
  await new Promise<void>((res) => socket.on('connect', () => res()))
  socket.emit('nearby:subscribe', { rideId })
  await sleep(8000)
  const cancelledAt = Date.now() - t0
  await pool.query(`UPDATE rides SET status = 'cancelled' WHERE id = $1`, [rideId]) // the ride stops searching; the client says nothing
  await sleep(50000)
  socket.close()
  const lastEvent = times.length ? times[times.length - 1]! : null
  console.log(`events before cancel: ${times.filter((t) => t <= cancelledAt).length}, after cancel: ${times.filter((t) => t > cancelledAt).length}`)
  console.log(`ride stopped searching at ${(cancelledAt / 1000).toFixed(1)} s; last car heard at ${lastEvent === null ? '-' : (lastEvent / 1000).toFixed(1)} s => stopped ${lastEvent === null ? '-' : ((lastEvent - cancelledAt) / 1000).toFixed(1)} s after`)
  await pool.end(); redis.disconnect()
}
void main().catch((e) => { console.error(e); process.exit(1) })
