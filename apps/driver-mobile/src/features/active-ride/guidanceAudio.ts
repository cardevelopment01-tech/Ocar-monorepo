// Values of the navigation SDK's AudioGuidance flags, kept here so this rule is testable without loading the native module.
// SILENT must stand alone; BLUETOOTH_AUDIO only works combined with a voice flag.
const SILENT = 0
const VOICE_ALERTS_AND_GUIDANCE = 4
const BLUETOOTH_AUDIO = 8

/** What the turn-by-turn voice should do: nothing when the driver has muted it, otherwise speak (also over Bluetooth / the car speakers). */
export function guidanceAudioFlags(muted: boolean): number {
  return muted ? SILENT : VOICE_ALERTS_AND_GUIDANCE | BLUETOOTH_AUDIO
}
