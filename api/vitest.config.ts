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
    // fileParallelism:false is slower (~5x wall time on the full 132-file
    // suite, ~30s -> ~160s) but verified race-free across 10+ runs; the suite
    // is small enough that ~2.5min sequential is still fine for CI.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
