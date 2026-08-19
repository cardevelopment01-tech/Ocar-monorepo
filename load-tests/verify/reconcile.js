#!/usr/bin/env node
/**
 * load-tests/verify/reconcile.js
 *
 * Run this AFTER a k6 session (main.js, accept-race.js, or both). k6's own
 * check()/threshold output only tells you what HTTP responses looked like —
 * it can't tell you whether the DATA a load test leaves behind is actually
 * correct. This queries staging directly for the failure modes that matter
 * more than latency: stuck rides, ledger drift, orphaned sessions, and —
 * the reason this script exists — rides accepted by a driver who was never
 * offered them (see accept-race.js's file header and README §9).
 *
 * Read-only. Scoped to synthetic data (users.phone LIKE '99999%') plus a
 * time window, so it's safe to run against a staging DB with real historical
 * rows sitting next to load-test rows.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node reconcile.js --since-hours 24
 *
 * Exit code 1 if any check finds violations (so this can gate a "test
 * session passed" decision, not just eyeballed).
 */

const { Client } = require('pg')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const SINCE_HOURS = parseInt(arg('since-hours', '24'), 10)
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required.')
  process.exit(1)
}

const SYNTHETIC_USERS = `(SELECT id FROM users WHERE phone LIKE '99999%')`

const CHECKS = [
  {
    name: 'Orphaned in-flight rides (stuck non-terminal, likely from an interrupted VU)',
    sql: `
      SELECT id, status, requested_at FROM rides
      WHERE user_id IN ${SYNTHETIC_USERS}
        AND status IN ('requested','accepted','driver_arrived','in_progress')
        AND requested_at < now() - interval '2 hours'
      ORDER BY requested_at LIMIT 20`,
    describe: (r) => `ride ${r.id} stuck '${r.status}' since ${r.requested_at.toISOString()}`,
  },
  {
    name: 'Rides whose final status has no matching ride_status_history row',
    sql: `
      SELECT r.id, r.status FROM rides r
      WHERE r.user_id IN ${SYNTHETIC_USERS}
        AND r.status IN ('completed','cancelled','no_drivers')
        AND r.requested_at > now() - ($1 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM ride_status_history h WHERE h.ride_id = r.id AND h.to_status = r.status
        )
      LIMIT 20`,
    params: [SINCE_HOURS],
    describe: (r) => `ride ${r.id} status='${r.status}' has no matching status_history row`,
  },
  {
    name: 'Payments where amount != commission_amount + driver_earning (ledger drift)',
    sql: `
      SELECT p.id, p.ride_id, p.amount, p.commission_amount, p.driver_earning FROM payments p
      JOIN rides r ON r.id = p.ride_id
      WHERE r.user_id IN ${SYNTHETIC_USERS}
        AND p.created_at > now() - ($1 || ' hours')::interval
        AND ABS(p.amount - (p.commission_amount + p.driver_earning)) > 0.01
      LIMIT 20`,
    params: [SINCE_HOURS],
    describe: (r) => `payment ${r.id} (ride ${r.ride_id}): amount=${r.amount} != commission=${r.commission_amount} + earning=${r.driver_earning}`,
  },
  {
    name: "Driver sessions stuck 'on_trip' with no matching active ride (orphaned accept)",
    sql: `
      SELECT ds.id, ds.driver_id, ds.went_on_trip_at FROM driver_sessions ds
      WHERE ds.status = 'on_trip'
        AND ds.went_online_at > now() - ($1 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM rides r WHERE r.driver_id = ds.driver_id
            AND r.status IN ('accepted','driver_arrived','in_progress')
        )
      LIMIT 20`,
    params: [SINCE_HOURS],
    describe: (r) => `driver_session ${r.id} (driver ${r.driver_id}) stuck on_trip since ${r.went_on_trip_at ? r.went_on_trip_at.toISOString() : '?'}, no matching active ride`,
  },
  {
    name: 'gps_tracks rows pointing at a session_id that no longer exists',
    sql: `
      SELECT count(*)::int AS n FROM gps_tracks g
      WHERE g.recorded_at > now() - ($1 || ' hours')::interval
        AND NOT EXISTS (SELECT 1 FROM driver_sessions ds WHERE ds.id = g.session_id)`,
    params: [SINCE_HOURS],
    isCount: true,
    describe: (r) => `${r.n} orphaned gps_tracks rows`,
  },
  {
    name: 'Rides accepted by a driver who was never in ride_assignments for that ride (hijack check — see accept-race.js)',
    sql: `
      SELECT r.id, r.driver_id, r.accepted_at FROM rides r
      WHERE r.user_id IN ${SYNTHETIC_USERS}
        AND r.driver_id IS NOT NULL
        AND r.accepted_at > now() - ($1 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM ride_assignments a WHERE a.ride_id = r.id AND a.driver_id = r.driver_id
        )
      LIMIT 20`,
    params: [SINCE_HOURS],
    describe: (r) => `ride ${r.id} accepted by driver ${r.driver_id} at ${r.accepted_at.toISOString()} with NO ride_assignments row — never offered this ride`,
  },
]

async function main() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()

  let anyFailed = false
  for (const check of CHECKS) {
    const res = await client.query(check.sql, check.params || [])
    const rows = res.rows
    const violationCount = check.isCount ? rows[0].n : rows.length
    const failed = violationCount > 0
    anyFailed = anyFailed || failed

    console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${check.name}`)
    if (failed) {
      if (check.isCount) {
        console.log(`  ${check.describe(rows[0])}`)
      } else {
        rows.forEach((r) => console.log(`  ${check.describe(r)}`))
        if (rows.length === 20) console.log('  ...(showing first 20)')
      }
    }
  }

  console.log(`\n${anyFailed ? 'RECONCILIATION FAILED — see FAIL sections above.' : 'All checks passed.'}`)
  await client.end()
  process.exit(anyFailed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
