import { defineConfig } from 'vitest/config'
import path from 'path'

// Local-only: stubs for packages not installed in this worktree. Not committed.
const stub = 'C:/Users/sujal/AppData/Local/Temp/empty-stub.mjs'
export default defineConfig({
  test: { globals: true, environment: 'node', setupFiles: ['./tests/setup.ts'], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      pdfkit: stub, nodemailer: stub, '@socket.io/redis-streams-adapter': stub, '@aws-sdk/client-rekognition': stub,
    },
  },
})
