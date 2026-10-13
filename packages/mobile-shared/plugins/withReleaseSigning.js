const { withAppBuildGradle } = require('expo/config-plugins')

// Expo's generated android/app/build.gradle signs release builds with the debug key, which Play rejects.
// This signs with the upload key instead when OCAR_UPLOAD_STORE_FILE (+ _STORE_PASSWORD, _KEY_ALIAS,
// _KEY_PASSWORD) are set in ~/.gradle/gradle.properties or passed with -P. The keystore and its passwords
// stay out of the repo. With the properties unset, release falls back to the debug key, so local test
// builds keep working.
const RELEASE_BLOCK = `
        release {
            if (findProperty('OCAR_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('OCAR_UPLOAD_STORE_FILE'))
                storePassword findProperty('OCAR_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('OCAR_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('OCAR_UPLOAD_KEY_PASSWORD')
            }
        }`

function applyReleaseSigning(contents) {
  if (contents.includes('OCAR_UPLOAD_STORE_FILE')) return contents
  // after the debug signing config, add the release one
  const debugCfg = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/
  if (!debugCfg.test(contents)) throw new Error('withReleaseSigning: signingConfigs.debug block not found')
  let out = contents.replace(debugCfg, `$1${RELEASE_BLOCK}`)
  // inside buildTypes.release, use it when configured
  const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/
  if (!releaseType.test(out)) throw new Error('withReleaseSigning: buildTypes.release signingConfig not found')
  out = out.replace(releaseType, `$1signingConfig findProperty('OCAR_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`)
  return out
}

module.exports = (config) => withAppBuildGradle(config, (c) => {
  c.modResults.contents = applyReleaseSigning(c.modResults.contents)
  return c
})
module.exports.applyReleaseSigning = applyReleaseSigning
