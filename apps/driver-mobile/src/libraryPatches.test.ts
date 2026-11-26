import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Value: protects=the driver's in-app ride request ring plays on the alarm volume (like the push ring) instead of a media volume the
// driver keeps low; fails_when=patches/expo-audio@*.patch is not applied in the installed package (a copy that dropped patches/ or
// pnpm.patchedDependencies would silently ship the quiet ring again); why_new=the in-app ring was about 7 dB quieter than the push ring;
// seam=the installed package's Android source; no_claim=the audible result (verified on a device build, not here).
const require = createRequire(import.meta.url)

describe('expo-audio patch', () => {
  it('is applied to the installed package (the player uses the alarm stream)', () => {
    const root = dirname(require.resolve('expo-audio/package.json'))
    const kt = readFileSync(join(root, 'android/src/main/java/expo/modules/audio/AudioPlayer.kt'), 'utf8')
    expect(kt).toContain('Ocar patch')
    expect(kt).toMatch(/\.setUsage\(C\.USAGE_ALARM\)/)
    expect(kt).not.toMatch(/setAudioAttributes\(AudioAttributes\.DEFAULT/)
  })
})

describe('expo-speech patch', () => {
  it('is applied to the installed package (the ride request voice uses the alarm stream, like the ring)', () => {
    const root = dirname(require.resolve('expo-speech/package.json'))
    const kt = readFileSync(join(root, 'android/src/main/java/expo/modules/speech/SpeechModule.kt'), 'utf8')
    expect(kt).toContain('Ocar patch')
    expect(kt).toMatch(/\.setUsage\(AudioAttributes\.USAGE_ALARM\)/)
    expect(kt).toMatch(/setAudioAttributes\(/)
  })
})

// Value: protects=the alarm-volume patches above actually reach the phone; fails_when=autolinking.buildFromSource stops listing expo-audio or
// expo-speech (Expo then links its prebuilt Android libraries and ignores the patched source, so the ring and the voice go back to the media
// volume while the two tests above still pass); why_new=that is exactly what happened until this setting existed; seam=package.json;
// no_claim=the audible result (verified on a device build).
describe('alarm-volume patches are compiled in', () => {
  it('package.json builds expo-audio and expo-speech from source', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { expo?: { autolinking?: { buildFromSource?: string[] } } }
    expect(pkg.expo?.autolinking?.buildFromSource).toEqual(expect.arrayContaining(['expo-audio', 'expo-speech']))
  })
})
