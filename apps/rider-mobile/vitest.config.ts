import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Scoped to pure-logic files only (no RN imports) -- same minimal shape as
// driver-mobile's vitest.config.ts / packages/mobile-shared's. Screen-level
// RN components stay on manual verification; this does not attempt to set up
// a full RN testing environment. The `@` alias lets a logic file that imports
// `@/...` be tested with its native modules mocked.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
  },
})
