#!/usr/bin/env node
//
// load-tests/verify/query-regression.js
//
// Automated query-plan / latency regression gate — the thing README §7 leaves
// as a manual EXPLAIN ANALYZE step. Snapshots pg_stat_statements for a set of
// NAMED critical queries, then compares a later snapshot and fails if their
// approximate p95 latency regressed past a tolerance. This is what turns
// "seed 1M rides, then eyeball EXPLAIN" into a pass/fail check you can gate on.
//
// pg_stat_statements does NOT store true percentiles, so p95 is approximated as
// mean_exec_time + 1.6449 * stddev_exec_time (one-sided 95%). It's statistically
// rough but practically useful for catching a plan flip (seq scan creeping in,
// an index stopping being used) that moves mean+stddev sharply — exactly the
// regression class §7 cares about after data volume grows.
//
// Requires pg_stat_statements enabled (README §2.4 — already a documented
// staging prerequisite) and the pg dependency (load-tests/package.json, same as
// reconcile.js). Read-only except for the optional --reset.
//
// Usage:
//   # 1. before the run/seed, reset stats to get a clean window:
//   DATABASE_URL=<staging> node verify/query-regression.js --reset
//   # 2. capture the baseline (after a warm-up run at current data volume):
//   DATABASE_URL=<staging> node verify/query-regression.js --mode baseline --out baseline.json
//   # 3. after the change (e.g. after generate-bulk-ride-history.js), check:
//   DATABASE_URL=<staging> node verify/query-regression.js --mode check \
//     --baseline baseline.json --tolerance 0.2 --abs-p95-ms 500
//
// Exits 1 if any named query's p95 regressed past BOTH the relative tolerance
// and the absolute ceiling, so it can gate a "this passed" decision.

const fs = require('fs')
const { Client } = require('pg')

// The critical queries §7 names, matched by a stable substring of the
// normalized query text in pg_stat_statements. Keep these fragments specific
// enough to match one statement family and nothing else. If a match is missing
// after a run, the workload never exercised it — the check reports that, it is
// not silently ignored.
//
// Fragments verified against the real SQL in api/src/modules/ (2026-08-19):
// - rides_list_admin / driver_ride_history both live in admin.repository.ts and
//   share the shape `FROM rides r ... ORDER BY r.requested_at DESC LIMIT ...` —
//   rides_list_admin's fragment is tightened past the plan's original guess
//   (`FROM rides r%ORDER BY%LIMIT`) to require the `LEFT JOIN drivers d` that
//   only listAdminRides has, so it can't be matched-and-outranked by
//   listDriverRides' call count under LIMIT 1 ORDER BY calls DESC.
// - live_map_bbox: no dedicated bounding-box query exists for the admin
//   live-map page (its query in admin.repository.ts lists all online driver
//   sessions with no ST_DWithin/ST_MakeEnvelope filter at all). The closest
//   real analog — and the only ST_DWithin usage — is the ride-driver-matching
//   query (findNearbyDrivers in rides.repository.ts), so this fragment targets
//   that instead. Also: in every real occurrence, `ST_DWithin(` appears BEFORE
//   `ST_MakePoint(` in the query text (the point is a nested argument), the
//   opposite order from the plan's original guess — corrected here.
// - ride_creation_insert: matches api/src/modules/rides/rides.repository.ts's
//   createRide INSERT verbatim at the start, no correction needed.
const CRITICAL_QUERIES = [
  { name: 'rides_list_admin',      match: 'FROM rides r%JOIN users u%LEFT JOIN drivers d%ORDER BY%LIMIT' },
  { name: 'driver_ride_history',   match: 'FROM rides%WHERE%driver_id%ORDER BY' },
  { name: 'live_map_bbox',         match: 'ST_DWithin%ST_MakePoint' },
  { name: 'ride_creation_insert',  match: 'INSERT INTO rides%' },
]

const Z_95 = 1.6449

function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
function hasFlag(flag) { return process.argv.includes(flag) }

function approxP95(meanMs, stddevMs) {
  return meanMs + Z_95 * (stddevMs || 0)
}

async function snapshot(client) {
  const out = {}
  for (const q of CRITICAL_QUERIES) {
    let res
    try {
      res = await client.query(
        `SELECT queryid, calls, mean_exec_time, stddev_exec_time
           FROM pg_stat_statements
          WHERE query LIKE $1
          ORDER BY calls DESC
          LIMIT 1`,
        [q.match]
      )
    } catch (err) {
      if (err && (err.code === '42P01' || /pg_stat_statements/.test(err.message || ''))) {
        console.error(
          'pg_stat_statements is not enabled on this database. See README §2.4 for how to enable it.'
        )
        process.exit(2)
      }
      throw err
    }
    const row = res.rows[0]
    out[q.name] = row
      ? {
          queryid: String(row.queryid),
          calls: Number(row.calls),
          mean_ms: Number(row.mean_exec_time),
          stddev_ms: Number(row.stddev_exec_time),
          p95_ms: approxP95(Number(row.mean_exec_time), Number(row.stddev_exec_time)),
        }
      : null
  }
  return out
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is required')
    process.exit(2)
  }
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  try {
    if (hasFlag('--reset')) {
      console.warn(
        '⚠ This resets pg_stat_statements for the ENTIRE database — not just the 4 tracked ' +
        'queries. Anyone else profiling this DB will lose their stats window too.'
      )
      await client.query('SELECT pg_stat_statements_reset()')
      console.log('pg_stat_statements reset — start your run/seed now.')
      return
    }

    const mode = arg('--mode', 'baseline')
    const snap = await snapshot(client)

    if (mode === 'baseline') {
      const outPath = arg('--out', 'baseline.json')
      fs.writeFileSync(outPath, JSON.stringify(snap, null, 2))
      console.log(`baseline written to ${outPath}`)
      for (const name of Object.keys(snap)) {
        console.log(
          snap[name]
            ? `  ${name}: p95~${snap[name].p95_ms.toFixed(1)}ms over ${snap[name].calls} calls`
            : `  ${name}: NOT OBSERVED (workload didn't hit it)`
        )
      }
      return
    }

    // mode === 'check'
    const baselinePath = arg('--baseline', 'baseline.json')
    const tolerance = Number(arg('--tolerance', '0.2'))    // 20% relative regression allowed
    const absP95 = Number(arg('--abs-p95-ms', '500'))      // hard ceiling regardless of baseline
    let baseline
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    } catch (err) {
      console.error(
        `Could not read/parse baseline file "${baselinePath}": ${err.message}. ` +
        'Run --mode baseline first.'
      )
      process.exit(2)
    }

    let failed = false
    for (const q of CRITICAL_QUERIES) {
      const before = baseline[q.name]
      const after = snap[q.name]
      if (!after) {
        failed = true
        console.warn(
          `✗ ${q.name}: NOT OBSERVED in this check run — cannot validate, workload must ` +
          'exercise this query'
        )
        continue
      }
      if (!before) {
        console.warn(`? ${q.name}: no baseline entry — capture a baseline first`)
        continue
      }
      const relLimit = before.p95_ms * (1 + tolerance)
      const regressedRel = after.p95_ms > relLimit
      const regressedAbs = after.p95_ms > absP95
      // Fail only when BOTH fire: a query slow in absolute terms but flat vs.
      // baseline was already slow (a known cost), and a query that grew but is
      // still fast is noise. A real regression is "grew AND is now slow".
      if (regressedRel && regressedAbs) {
        failed = true
        console.error(
          `✗ ${q.name}: p95 ${before.p95_ms.toFixed(1)}ms -> ${after.p95_ms.toFixed(1)}ms ` +
          `(> ${(tolerance * 100).toFixed(0)}% AND > ${absP95}ms ceiling)`
        )
      } else {
        console.log(
          `✓ ${q.name}: p95 ${before.p95_ms.toFixed(1)}ms -> ${after.p95_ms.toFixed(1)}ms`
        )
      }
    }
    if (failed) {
      console.error('\nQuery-plan regression detected — see EXPLAIN ANALYZE per README §7.')
      process.exit(1)
    }
    console.log('\nNo query regressions past threshold.')
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error(err); process.exit(2) })
