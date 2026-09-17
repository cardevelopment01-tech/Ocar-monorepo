import { defineConfig } from 'vitest/config'

// Scoped to pure-logic files only (no RN imports) -- same minimal shape as
// packages/mobile-shared/vitest.config.ts. Screen-level RN components stay on
// manual verification per the existing TODOS.md item; this does not attempt to
// set up a full RN testing environment.
export default defineConfig({
  test: {
    environment: 'node',
  },
})
