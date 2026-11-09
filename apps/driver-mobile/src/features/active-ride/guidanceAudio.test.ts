import { describe, expect, it } from 'vitest'
import { guidanceAudioFlags } from './guidanceAudio'

// Value: protects=a driver who mutes the navigation voice hears nothing, and one who does not still gets spoken turns (also over
// Bluetooth); fails_when=muting combines SILENT with other flags (the SDK forbids that) or unmuted loses Bluetooth/voice;
// why_new=mute button on the guided map; seam=none (pure); no_claim=the native SDK actually going quiet.
describe('guidanceAudioFlags', () => {
  it('muted is SILENT on its own, with no other flag combined', () => {
    expect(guidanceAudioFlags(true)).toBe(0)
  })
  it('unmuted speaks alerts and guidance, over Bluetooth too', () => {
    expect(guidanceAudioFlags(false)).toBe(4 | 8)
  })
})
