// Sentry's variant adds debug ids to the bundle and source map, so release stack traces are readable.
const { getSentryExpoConfig } = require('@sentry/react-native/metro')

// Expo SDK 52+ auto-detects pnpm/Turborepo monorepos (workspace root, symlinks,
// multi-level node_modules) — no manual watchFolders/nodeModulesPaths needed here.
module.exports = getSentryExpoConfig(__dirname)
