// The booked-window clock must cross every boundary at the same instant on all four clients. This runs the
// shared boundary table (packages/mobile-shared/src/utils/tripWindow.cases.json) against this app's copy of
// tripWindow.ts. If it fails, re-copy packages/mobile-shared/src/utils/tripWindow.ts over src/lib/tripWindow.ts.
// Run with: cd api && npx tsx ../apps/driver/src/lib/__checks__/trip-window.check.ts
import { tripWindow } from '../tripWindow'
import rawTable from '../../../../../packages/mobile-shared/src/utils/tripWindow.cases.json'

const table = rawTable as unknown as {
  bookedUntil: string; graceMin: number; overtimeRate: number
  inputs: Array<Record<string, unknown> & { name: string; nowOffsetMs: number; expect: unknown }>
}

const base = new Date(table.bookedUntil).getTime()
let failed = 0
for (const c of table.inputs) {
  const got = tripWindow({
    bookedUntil: ('bookedUntil' in c ? c['bookedUntil'] : table.bookedUntil) as string | null,
    graceMin: ('graceMin' in c ? c['graceMin'] : table.graceMin) as number | null,
    overtimeRate: ('overtimeRate' in c ? c['overtimeRate'] : table.overtimeRate) as number | null,
    now: base + c.nowOffsetMs,
  })
  if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
    failed += 1
    console.error(`FAIL: ${c.name}\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(c.expect)}`)
  }
}
if (failed > 0) throw new Error(`${failed} boundary case(s) failed`)
console.log(`trip-window.check: ${table.inputs.length} boundary cases OK`)
