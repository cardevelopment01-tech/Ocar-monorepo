#!/usr/bin/env node
/**
 * load-tests/seed/activate-restored-driver-vehicles.js
 *
 * A prod DB snapshot restored into staging (see
 * docs/superpowers/specs/2026-08-31-load-test-seed-data-spec.md) carries
 * real drivers whose vehicles are often still `driver_vehicles.status =
 * 'pending'` (never admin-approved at snapshot time) -- both
 * generate-test-tokens.js and generate-bulk-ride-history.js require an
 * `active` vehicle to reuse a driver. Run this once after every snapshot
 * restore, before either seed script.
 *
 * Usage (no DATABASE_URL needed -- see lib/staging-db.js):
 *   node activate-restored-driver-vehicles.js
 */

const { Client } = require('pg')
const { getStagingDbConfig } = require('./lib/staging-db')

async function main() {
  const client = new Client(getStagingDbConfig())
  await client.connect()
  const res = await client.query(
    `UPDATE driver_vehicles SET status = 'active'
     WHERE driver_id IN (SELECT id FROM drivers WHERE status = 'active' AND city_id IS NOT NULL)
     AND status = 'pending'`
  )
  console.log(`${res.rowCount} driver_vehicles rows updated to 'active'.`)
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
