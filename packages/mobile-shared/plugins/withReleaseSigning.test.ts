import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const { applyReleaseSigning } = createRequire(import.meta.url)('./withReleaseSigning.js') as { applyReleaseSigning: (s: string) => string }

const GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution!
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}`

describe('applyReleaseSigning', () => {
  const out = applyReleaseSigning(GRADLE)

  it('adds a release signing config read from gradle properties', () => {
    expect(out).toContain("storeFile file(findProperty('OCAR_UPLOAD_STORE_FILE'))")
    expect(out).toContain("keyPassword findProperty('OCAR_UPLOAD_KEY_PASSWORD')")
  })

  it('release build type uses it when configured and falls back to debug otherwise; debug type is untouched', () => {
    expect(out).toContain("signingConfig findProperty('OCAR_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug")
    expect(out.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(1) // the debug build type only
  })

  it('is idempotent across repeated prebuilds', () => {
    expect(applyReleaseSigning(out)).toBe(out)
  })

  it('fails loudly when the template changes shape', () => {
    expect(() => applyReleaseSigning('android { }')).toThrow('signingConfigs.debug block not found')
  })
})
