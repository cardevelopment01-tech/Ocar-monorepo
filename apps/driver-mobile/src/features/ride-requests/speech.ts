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
