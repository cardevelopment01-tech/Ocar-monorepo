const { withAndroidManifest } = require('expo/config-plugins')

// The rider app only uses foreground location, but expo-location's own manifest still declares a
// location foreground service (LocationTaskService). Play then sees a foreground service in the
// merged manifest and a reviewer can ask for a declaration and video for something that never runs.
// Mark it for removal at manifest merge. Pairs with blocking android.permission.FOREGROUND_SERVICE
// in app.json.
const SERVICE = 'expo.modules.location.services.LocationTaskService'

function removeLocationService(manifest) {
  manifest.$ = manifest.$ ?? {}
  manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools'
  const app = manifest.application[0]
  app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE)
  app.service.push({ $: { 'android:name': SERVICE, 'tools:node': 'remove' } })
  return manifest
}

module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    removeLocationService(c.modResults.manifest)
    return c
  })
module.exports.removeLocationService = removeLocationService
