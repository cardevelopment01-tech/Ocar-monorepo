// Test-only preload (see vitest.config.ts). This monorepo hoists react-dom 19.2.7
// to the root next to a *different* root react (19.2.3, pinned by the mobile apps),
// while this app resolves its own react 19.2.7. react-dom refuses mismatched
// versions and RTL's act() would talk to a different React than react-dom, so
// renders never commit. Force every CJS `require('react')` in the test process
// — react-dom's and RTL's included — onto the app's copy.
const Module = require('module')
const path = require('path')

// Resolve from this app's directory (works whether install nests react here or hoists it).
const appReact = path.dirname(require.resolve('react/package.json', { paths: [__dirname] }))
const original = Module._resolveFilename

Module._resolveFilename = function (request, ...rest) {
  if (request === 'react' || request.startsWith('react/')) {
    request = appReact + request.slice('react'.length)
  }
  return original.call(this, request, ...rest)
}
