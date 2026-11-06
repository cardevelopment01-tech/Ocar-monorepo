// Test-only (never committed): re-login the seeded drivers (fresh tokens) and keep their sessions/positions in state.json.
import fs from 'fs'
import { client as redis } from '@/db/redis'
import { pool } from '@/db/client'
import { createApp } from '@/app'
import { loginDriver } from '../tests/helpers/fixtures/rides.fixture'

async function main() {
  const app = createApp()
  const state = JSON.parse(fs.readFileSync('scripts/maptest-state.json', 'utf8')) as Array<{ phone: string; accessToken: string }>
  for (const d of state) d.accessToken = (await loginDriver(app, redis, d.phone)).accessToken
  fs.writeFileSync('scripts/maptest-state.json', JSON.stringify(state, null, 1))
  console.log('refreshed', state.length)
  await pool.end(); redis.disconnect()
}
void main()
