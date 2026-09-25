import { defineConfig } from 'vitest/config'
import path from 'path'
import { createRequire } from 'module'

// The react this app resolves (see vitest.react-pin.cjs for why tests must pin it).
const appReact = path.dirname(createRequire(path.join(__dirname, 'package.json')).resolve('react/package.json'))

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.resolve(__dirname, '.') + '/' },
      // Keep test-file/JSX imports on the app's react too (the CJS side is
      // handled by vitest.react-pin.cjs below).
      { find: /^react$/, replacement: path.join(appReact, 'index.js') },
      { find: /^react\/(.*)$/, replacement: appReact + '/$1' },
    ],
  },
  test: {
    environment: 'node',
    // Component tests opt into jsdom with `// @vitest-environment jsdom`.
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    setupFiles: ['./vitest.setup.ts'],
    // ESM deps bypass the CJS pin above (native ESM resolution finds radix's own
    // nested react) — inline them so the vite alias above applies to their imports.
    server: { deps: { inline: [/@radix-ui/, /lucide-react/, /@testing-library/] } },
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--require', path.resolve(__dirname, 'vitest.react-pin.cjs')] } },
  },
})
