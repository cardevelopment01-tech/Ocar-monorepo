import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests share one real Postgres/Redis instance (no per-file DB
    // isolation) and several fixtures reuse the same lat/lng + city + category,
    // so concurrent files can race each other's driver-broadcast queries and
    // hit FK violations (e.g. ride_assignments_session_id_fkey) when one file's
    // afterAll cleanup deletes rows another file's in-flight request still
    // references (confirmed: unpatched full-suite run hit that exact FK error
    // in m02.test.ts, not just m07/m08 — this is suite-wide, not file-pair-
    // specific). Tried scoping this to only tests/integration/** via
    // poolMatchGlobs + poolOptions.forks.singleFork to keep unit tests on
    // default thread parallelism, but that routing did not reliably force
    // single-file-at-a-time execution (the race still reproduced ~1/5 runs) —
    // not worth the added config surface for an unreliable win. Blanket
    // fileParallelism:false is slower (~3.3x wall time on the full 132-file
    // suite, ~30s -> ~100s) but verified race-free across 10+ runs; the suite
    // is small enough that this is still fine for CI.
    //
    // This treats the symptom, not the root cause: integration fixtures across
    // files reuse the same lat/lng/city/category, so concurrent broadcasts
    // collide. The real fix is giving each integration test file its own
    // disjoint slice of fixture space (e.g. a city/category per file) so
    // parallelism can be re-enabled safely — not yet attempted, tracked as
    // follow-up work rather than done here under this plan's scope.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
