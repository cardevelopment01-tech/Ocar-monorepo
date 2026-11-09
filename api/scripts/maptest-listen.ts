// Test-only (never committed): behaves like the rider app's socket for the live nearby-cars feed, and reports what arrives.
import { io } from 'socket.io-client'
import { client as redis } from '@/db/redis'
import { pool } from '@/db/client'
import { createApp } from '@/app'
import { loginUser, loginDriver } from '../tests/helpers/fixtures/rides.fixture'

const RIDER = process.env['REVIEW_PHONE'] ?? '+919700000811'
const OTHER = '+919700000812'
const base = process.env['BASE'] ?? 'http://localhost:4000'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Ev = { at: number; id: string; lat: number; lng: number; heading?: number; categoryId: number }

async function listen(token: string, subscribeRide: string | null, ms: number, label: string, unsubscribeAt?: number) {
  const socket = io(base, { transports: ['websocket'], auth: { token } })
  const events: Ev[] = []
  const t0 = Date.now()
  socket.on('nearby:car', (p: Omit<Ev, 'at'>) => events.push({ at: Date.now() - t0, ...p }))
  await new Promise<void>((res, rej) => { socket.on('connect', () => res()); socket.on('connect_error', rej) })
  if (subscribeRide) socket.emit('nearby:subscribe', { rideId: subscribeRide })
  if (unsubscribeAt) { await sleep(unsubscribeAt); socket.emit('nearby:unsubscribe') }
  await sleep(ms - (unsubscribeAt ?? 0))
  socket.close()
  return { label, events }
}

function summarise({ label, events }: { label: string; events: Ev[] }, after = 0) {
  const ev = events.filter((e) => e.at >= after)
  const byId = new Map<string, number[]>()
  for (const e of ev) byId.set(e.id, [...(byId.get(e.id) ?? []), e.at])
  const gaps: number[] = []
  for (const ats of byId.values()) for (let i = 1; i < ats.length; i++) gaps.push(ats[i]! - ats[i - 1]!)
  const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null
  const sample = ev[0] ? JSON.stringify({ ...ev[0], at: undefined }) : '-'
  console.log(`${label}: ${ev.length} events, ${byId.size} distinct cars, avg gap per car ${avg} ms, first=${sample}`)
}

async function main() {
  const app = createApp()
  const rider = await loginUser(app, redis, RIDER)
  const other = await loginUser(app, redis, OTHER)
  const driver = await loginDriver(app, redis, '+919700001001')
  const rideRow = await pool.query(`SELECT id::text FROM rides WHERE user_id = $1 AND status = 'requested' ORDER BY id DESC LIMIT 1`, [rider.userId])
  const rideId = rideRow.rows[0]?.id as string | undefined
  console.log('searching ride:', rideId)
  if (!rideId) throw new Error('book a ride first')

  const [mine, theirs, asDriver, junk] = await Promise.all([
    listen(rider.accessToken, rideId, 16000, 'RIDER (own searching ride)', 12000),
    listen(other.accessToken, rideId, 10000, 'OTHER RIDER (not their ride)'),
    listen(driver.accessToken, rideId, 10000, 'A DRIVER'),
    listen(rider.accessToken, '9999999', 10000, 'RIDER (a ride id that is not theirs)'),
  ])
  summarise({ label: mine.label + ' while subscribed', events: mine.events.filter((e) => e.at < 12000) })
  summarise({ label: mine.label + ' after unsubscribe', events: mine.events.filter((e) => e.at >= 12500) })
  summarise(theirs)
  summarise(asDriver)
  summarise(junk)
  await pool.end(); redis.disconnect()
}
void main().catch((e) => { console.error(e); process.exit(1) })
