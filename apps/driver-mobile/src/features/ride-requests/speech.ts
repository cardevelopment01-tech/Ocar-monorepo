// expo-speech is a native module. A JS bundle delivered to a build made before the module was added (an over-the-air
// update, or a dev bundle on an older APK) would crash at import time. Load it lazily and treat "not there" as "no voice":
// the ring and the pop-up keep working without it.
type SpeechModule = typeof import('expo-speech')

let cached: SpeechModule | null | undefined

export function getSpeech(): SpeechModule | null {
  if (cached === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require('expo-speech') as SpeechModule
    } catch {
      cached = null
    }
  }
  return cached
}

// The first speak() after the app starts, or after a long idle, pays for the phone creating its speech engine (often a second or two)
// before the first word. Asking the engine for its voice list makes it create itself now, in the background, so the first request is
// read without that delay. Best effort: no engine or no module is the same as before.
export function warmUpSpeech(speech: Pick<SpeechModule, 'getAvailableVoicesAsync'> | null = getSpeech()): void {
  try {
    void Promise.resolve(speech?.getAvailableVoicesAsync()).catch(() => {})
  } catch {
    // no voice on this build
  }
}
