import { useEffect } from 'react'
import { Vibration } from 'react-native'
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio'
import * as Speech from 'expo-speech'
import rideAlertSoundAsset from '../../../assets/sounds/ride-request.wav'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { buildAnnouncement, SPEECH_LOCALE } from './buildAnnouncement'
import { stopTestAlert } from './testAlert'
import type { RideRequestPayload } from './types'

function safePause(player: AudioPlayer) {
  try {
    player.pause()
  } catch {
    // Player already released natively -- nothing left to pause.
  }
}

// Same asset + same repeating-loop behavior as the web driver app's
// lib/rideSound.ts (playRideSound/stopRideSound) -- ported to expo-audio
// instead of reimplemented, per the plan's reuse-ladder correction.
const RIDE_ALERT_SOUND = rideAlertSoundAsset

// Uber-style pattern: buzz, pause, buzz, repeat -- not a single blip.
const VIBRATION_PATTERN = [0, 400, 200, 400]

// Ring once (long enough to get the driver's attention), then read the request aloud, then ring again until the request
// is answered. The ring is paused while speaking so the two never fight over the speaker.
const RING_BEFORE_SPEECH_MS = 1600

let audioModeSet = false

// Must run once before the first play() -- without it, iOS silences the alert
// entirely when the phone's hardware silent switch is on, which defeats the
// entire point of a "must not miss it" ride-request alarm (outside review's
// highest-impact flagged risk).
// shouldPlayInBackground stays false: background playback needs Android's media-playback foreground service,
// which we no longer ship (Play makes every foreground service type a declared, reviewed item). A request that
// arrives while the app is backgrounded is announced by the push notification's own channel sound instead.
function ensureAudioMode() {
  if (audioModeSet) return
  audioModeSet = true
  setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false }).catch(() => {})
}

/** Plays a repeating alert tone + vibration while `active` is true, and reads `request` aloud once after the first ring
 *  (when the driver has voice on). Stops immediately when `active` flips to false. */
export function useRideAlertSound(active: boolean, request?: RideRequestPayload | null): void {
  const player = useAudioPlayer(RIDE_ALERT_SOUND)
  const voiceEnabled = useAlertPrefsStore((s) => s.voiceEnabled)
  const language = useAlertPrefsStore((s) => s.language)
  const rideId = request?.rideId

  useEffect(() => {
    ensureAudioMode()
    player.loop = true
    player.volume = 1 // the player's own gain at full; the phone's volume is the driver's
  }, [player])

  useEffect(() => {
    if (!active) {
      safePause(player)
      Vibration.cancel()
      return
    }
    stopTestAlert() // a real request always wins over the Settings test
    let cancelled = false
    let spoke = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const ring = () => {
      if (cancelled) return
      player.seekTo(0).catch(() => {})
      player.play()
    }
    ring()
    Vibration.vibrate(VIBRATION_PATTERN, true)
    if (voiceEnabled && request) {
      const text = buildAnnouncement(request, language)
      timer = setTimeout(() => {
        if (cancelled) return
        safePause(player)
        spoke = true
        const resume = () => { clearTimeout(watchdog); ring() }
        // No TTS engine, a missing language or lost audio focus can mean no callback ever fires: the ring must come back anyway.
        watchdog = setTimeout(resume, Math.min(9_000, 2_500 + text.length * 70))
        Speech.speak(text, { language: SPEECH_LOCALE[language], rate: 0.95, onDone: resume, onStopped: resume, onError: resume })
      }, RING_BEFORE_SPEECH_MS)
    }
    // Cleanup covers unmount mid-ring (e.g. fast navigation away) so the alarm
    // and vibration never outlive the overlay that triggered them. By the
    // time this runs on unmount, expo-audio may have already released the
    // native player (observed as "Cannot use shared object that was already
    // released") -- pause() on an already-released player is a no-op we want,
    // not a crash, so it's swallowed rather than left to throw.
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(watchdog)
      if (spoke) Promise.resolve(Speech.stop()).catch(() => {}) // only what this hook started: other speech in the app is left alone
      safePause(player)
      Vibration.cancel()
    }
    // `request` is intentionally keyed by rideId: a new request re-announces, a re-render of the same one does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rideId, voiceEnabled, language, player])
}
