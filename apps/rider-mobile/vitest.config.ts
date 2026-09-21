import { defineConfig } from 'vitest/config'

// Scoped to pure-logic files only (no RN imports) -- same minimal shape as
// driver-mobile's vitest.config.ts / packages/mobile-shared's. Screen-level
// RN components stay on manual verification; this does not attempt to set up
// a full RN testing environment.
export default defineConfig({
  test: {
    environment: 'node',
  },
})
