import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// The plugin is plain CommonJS (Expo loads it with require); load it the same way.
const { applyPayuGradle, applyPayuManifest } = createRequire(import.meta.url)('./withPayuSdk.js') as {
  applyPayuGradle: (contents: string, rnVersion: string) => string
  applyPayuManifest: (m: { $: Record<string, string>; application: Array<{ $: Record<string, string> }> }) => unknown
}

const ROOT_GRADLE = `buildscript { }\nallprojects { repositories { google() } }\napply plugin: "expo-root-project"\n`

describe('withPayuSdk gradle', () => {
  const out = applyPayuGradle(ROOT_GRADLE, '0.86.3')

  it("substitutes the SDK's legacy react-native coordinate with react-android at the app's RN version", () => {
    expect(out).toContain("substitute module('com.facebook.react:react-native') using module('com.facebook.react:react-android:0.86.3')")
  })
  it('declares the PhonePe Maven repo for the SDK\'s transitive IntentSDK', () => {
    expect(out).toContain('phonepe.mycloudrepo.io/public/repositories/phonepe-intentsdk-android')
  })
  it('is idempotent (prebuild runs plugins on an already-patched file)', () => {
    expect(applyPayuGradle(out, '0.86.3')).toBe(out)
  })
  it('keeps the original content and never adds debug/test PayU settings (production-safe)', () => {
    expect(out.startsWith(ROOT_GRADLE)).toBe(true)
    expect(out).not.toMatch(/payu_debug_mode_enabled|test\.payu\.in/)
  })
})

describe('withPayuSdk manifest', () => {
  const mk = (replace?: string) => ({
    $: {} as Record<string, string>,
    application: [{ $: replace ? { 'tools:replace': replace } : {} }],
  })

  it('overrides the application theme the PayU UI library declares', () => {
    const m = mk()
    applyPayuManifest(m)
    expect(m.$['xmlns:tools']).toBe('http://schemas.android.com/tools')
    expect(m.application[0]!.$['tools:replace']).toBe('android:theme')
  })
  it('merges with an existing tools:replace instead of clobbering it', () => {
    const m = mk('android:allowBackup')
    applyPayuManifest(m)
    expect(m.application[0]!.$['tools:replace']!.split(',').sort()).toEqual(['android:allowBackup', 'android:theme'])
  })
  it('is idempotent', () => {
    const m = mk()
    applyPayuManifest(m)
    applyPayuManifest(m)
    expect(m.application[0]!.$['tools:replace']).toBe('android:theme')
  })
})
