const { getDefaultConfig } = require('expo/metro-config')

// Expo SDK 52+ auto-detects pnpm/Turborepo monorepos (workspace root, symlinks,
// multi-level node_modules) — no manual watchFolders/nodeModulesPaths needed here.
module.exports = getDefaultConfig(__dirname)
