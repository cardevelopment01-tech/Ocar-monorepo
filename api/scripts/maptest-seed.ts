// Test-only (never committed): seeds N online drivers around a pickup in the LOCAL test database and writes state.json
// (tokens + session ids) for maptest-mover.ts / maptest-ride.ts.
import fs from 'fs'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { createApp } from '@/app'
import { loginDriver, seedActiveDriverWithVehicle, goOnline } from '../tests/helpers/fixtures/rides.fixture'

export const PICKUP = { lat: 20.2961, lng: 85.8245 } // central Bhubaneswar
const DEG_PER_M = 1 / 111_320
// [distance m, bearing deg, category]
const RING: Array<[number, number, 'sedan' | 'hatchback']> = [
  [250, 20, 'sedan'], [420, 110, 'hatchback'], [700, 200, 'sedan'], [900, 290, 'hatchback'],
  [1300, 60, 'sedan'], [1800, 160, 'hatchback'], [2400, 250, 'sedan'],
]
const at = (d: number, b: number) => ({
  lat: PICKUP.lat + (d * Math.cos((b * Math.PI) / 180)) * DEG_PER_M,
  lng: PICKUP.lng + (d * Math.sin((b * Math.PI) / 180)) * DEG_PER_M / Math.cos((PICKUP.lat * Math.PI) / 180),
})

async function main() {
  const app = createApp()
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  const out: unknown[] = []
  for (let i = 0; i < RING.length; i++) {
    const [d, b, cat] = RING[i]!
    const phone = `+91970000${1001 + i}`
    const { accessToken, driverId } = await loginDriver(app, redis, phone)
    let vrow = (await pool.query('SELECT id, category_id FROM driver_vehicles WHERE driver_id=$1 LIMIT 1', [driverId])).rows[0]
    let categoryId: number
    if (!vrow) {
      const r = await seedActiveDriverWithVehicle(pool, driverId, { categorySlug: cat, plate: `OD02MT${1001 + i}` })
      vrow = { id: r.vehicleId }; categoryId = r.categoryId
    } else {
      categoryId = Number((await pool.query('SELECT category_id FROM driver_vehicles WHERE id=$1', [vrow.id])).rows[0].category_id)
    }
    await pool.query(`UPDATE drivers SET status='active' WHERE id=$1`, [driverId])
    for (const kind of ['daily_selfie', 'daily_plate']) {
      await pool.query(`DELETE FROM driver_verifications WHERE driver_id=$1 AND kind=$2 AND verified_for=$3`, [driverId, kind, today])
      await pool.query(`INSERT INTO driver_verifications (driver_id, vehicle_id, kind, verified_for, image_url, status) VALUES ($1,$2,$3,$4,'https://x.test/y.jpg','auto_passed')`, [driverId, String(vrow.id), kind, today])
    }
    const pos = at(d, b)
    const on = await goOnline(app, accessToken, String(vrow.id), categoryId, pos)
    const sessionId = on.body?.session?.id ?? on.body?.sessionId ?? on.body?.id
    console.log(phone, 'driver', driverId, 'online', on.status, 'session', sessionId, cat)
    if (on.status >= 300) console.log(JSON.stringify(on.body))
    out.push({ phone, driverId, accessToken, sessionId, categoryId, lat: pos.lat, lng: pos.lng, bearing: b })
  }
  fs.writeFileSync('scripts/maptest-state.json', JSON.stringify(out, null, 1))
  await pool.end(); redis.disconnect()
}
void main()
