import { useEffect, useRef } from 'react'
import { Vibration } from 'react-native'
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio'
import { getSpeech, hasVoiceFor } from './speech'
import rideAlertSoundAsset from '../../../assets/sounds/ride-request.wav'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { buildAnnouncementSegments, SPEECH_LOCALE, SPEECH_RATE } from './buildAnnouncement'
import { runAnnouncement } from './runAnnouncement'
import { useAnnouncementStore } from '@/store/useAnnouncementStore'
import { stopTestAlert } from './testAlert'
import type { RideRequestPayload } from './types'

function safePause(player: AudioPlayer) {
  try {
    player.pause()
  } catch {
    // Player already released natively -- nothing left to pause.
  }
}

// The ring from the top again (after the voice has finished, or was stopped because it was not helping).
function restartRing(player: AudioPlayer) {
  player.seekTo(0).catch(() => {})
  player.play()
}

// Same asset + same repeating-loop behavior as the web driver app's
// lib/rideSound.ts (playRideSound/stopRideSound) -- ported to expo-audio
// instead of reimplemented, per the plan's reuse-ladder correction.
const RIDE_ALERT_SOUND = rideAlertSoundAsset

// Uber-style pattern: buzz, pause, buzz, repeat -- not a single blip.
const VIBRATION_PATTERN = [0, 400, 200, 400]

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
 *  (when the driver has voice on). Stops immediately when `active` flips to false. The ring and the voice are separate
 *  effects: a late change to the voice settings restarts only the voice, never the ring. */
export function useRideAlertSound(active: boolean, request?: RideRequestPayload | null): void {
  const player = useAudioPlayer(RIDE_ALERT_SOUND)
  const voiceEnabled = useAlertPrefsStore((s) => s.voiceEnabled)
  const language = useAlertPrefsStore((s) => s.language)
  const prefsReady = useAlertPrefsStore((s) => s.hasHydrated)
  const rideId = request?.rideId
  const activeNow = useRef(active)
  activeNow.current = active

  useEffect(() => {
    ensureAudioMode()
    player.loop = true
    player.volume = 1 // the player's own gain at full; the phone's volume is the driver's
  }, [player])

  // The ring and vibration.
  useEffect(() => {
    if (!active) {
      safePause(player)
      Vibration.cancel()
      return
    }
    stopTestAlert() // a real request always wins over the Settings test
    player.seekTo(0).catch(() => {})
    player.play()
    Vibration.vibrate(VIBRATION_PATTERN, true)
    // Cleanup covers unmount mid-ring (e.g. fast navigation away) so the alarm
    // and vibration never outlive the overlay that triggered them. By the
    // time this runs on unmount, expo-audio may have already released the
    // native player (observed as "Cannot use shared object that was already
    // released") -- pause() on an already-released player is a no-op we want,
    // not a crash, so it's swallowed rather than left to throw.
    return () => {
      safePause(player)
      Vibration.cancel()
    }
  }, [active, rideId, player])

  // The voice: once per request, after the first ring (see runAnnouncement for the order of events and its timers).
  useEffect(() => {
    if (!active || !prefsReady || !voiceEnabled || !request) return
    const Speech = getSpeech() // null: no voice on this build; the ring carries on alone
    if (!Speech) return
    // A phone without a Hindi voice would read Devanagari with its English one. Find out now (the voice is only asked to speak after
    // the first ring), and read the request in English if there is none; an answer that has not come back by then changes nothing.
    let useEnglish = false
    if (language === 'hi') void hasVoiceFor('hi', Speech).then((ok) => { if (!ok) useEnglish = true })
    return runAnnouncement({
      speech: Speech,
      build: () => {
        const lang = useEnglish ? 'en' : language
        return { segments: buildAnnouncementSegments(request, lang), locale: SPEECH_LOCALE[lang], rate: SPEECH_RATE }
      },
      ring: { pause: () => safePause(player), resume: () => restartRing(player) },
      announcement: useAnnouncementStore.getState(),
      isActive: () => activeNow.current,
    })
    // `request` is intentionally keyed by rideId: a new request re-announces, a re-render of the same one does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rideId, voiceEnabled, language, prefsReady, player])
}
