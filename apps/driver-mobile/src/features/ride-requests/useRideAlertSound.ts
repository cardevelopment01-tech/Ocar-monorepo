import { useEffect, useRef } from 'react'
import { Vibration } from 'react-native'
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio'
import { getSpeech } from './speech'
import rideAlertSoundAsset from '../../../assets/sounds/ride-request.wav'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { buildAnnouncementSegments, estimateSpeechMs, segmentAt, segmentAtTime, SPEECH_LOCALE } from './buildAnnouncement'
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

// Same asset + same repeating-loop behavior as the web driver app's
// lib/rideSound.ts (playRideSound/stopRideSound) -- ported to expo-audio
// instead of reimplemented, per the plan's reuse-ladder correction.
const RIDE_ALERT_SOUND = rideAlertSoundAsset

// Uber-style pattern: buzz, pause, buzz, repeat -- not a single blip.
const VIBRATION_PATTERN = [0, 400, 200, 400]

// Ring once (long enough to get the driver's attention), then read the request aloud, then ring again until the request
// is answered. The ring is paused while speaking so the two never fight over the speaker.
const RING_BEFORE_SPEECH_MS = 1600
const FALLBACK_AFTER_MS = 1200 // no word positions this long after the voice starts: follow the clock instead

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

  // The voice: once per request, after the first ring.
  useEffect(() => {
    if (!active || !prefsReady || !voiceEnabled || !request) return
    const Speech = getSpeech() // null: no voice on this build; the ring carries on alone
    if (!Speech) return
    const segments = buildAnnouncementSegments(request, language)
    const text = segments.map((s) => s.text).join(' ')
    const announcement = useAnnouncementStore.getState()
    let cancelled = false
    let finished = false
    let spoke = false
    let sawBoundary = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setTimeout> | undefined
    let timeline: ReturnType<typeof setInterval> | undefined
    const stopTimeline = () => {
      clearTimeout(fallback)
      clearInterval(timeline)
      timeline = undefined
    }
    const resumeRing = () => {
      player.seekTo(0).catch(() => {})
      player.play()
    }
    // Runs once however many of onDone / onStopped / onError / the watchdog fire, and never after this effect was torn down.
    const finish = () => {
      if (cancelled || finished) return
      finished = true
      clearTimeout(watchdog)
      stopTimeline()
      announcement.reset()
      resumeRing()
    }
    timer = setTimeout(() => {
      if (cancelled) return
      safePause(player)
      spoke = true
      // No TTS engine, a missing language or lost audio focus can mean no callback ever fires: the ring must come back anyway.
      watchdog = setTimeout(finish, Math.min(9_000, 2_500 + text.length * 70))
      Speech.speak(text, {
        language: SPEECH_LOCALE[language],
        rate: 0.95,
        onStart: () => {
          if (cancelled || finished) return
          announcement.set({ speaking: true, segment: null })
          // Some Android speech engines never report word positions. If none arrive shortly after the start, follow an even
          // pace over the estimated duration instead; real positions take over the moment they show up.
          const startedAt = Date.now()
          const total = estimateSpeechMs(text)
          fallback = setTimeout(() => {
            if (cancelled || finished || sawBoundary || timeline) return
            timeline = setInterval(() => announcement.set({ segment: segmentAtTime(segments, Date.now() - startedAt, total) }), 250)
          }, FALLBACK_AFTER_MS)
        },
        onBoundary: (ev: { charIndex: number }) => {
          if (cancelled || finished) return
          sawBoundary = true
          stopTimeline()
          announcement.set({ segment: segmentAt(segments, ev.charIndex) })
        },
        onDone: finish,
        onStopped: finish,
        onError: finish,
      })
    }, RING_BEFORE_SPEECH_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(watchdog)
      stopTimeline()
      announcement.reset()
      if (spoke) {
        Promise.resolve(getSpeech()?.stop()).catch(() => {}) // only what this effect started: other speech is left alone
        // The voice was switched off or changed while the ring was paused for it: bring the ring back (unless the request ended).
        if (!finished && activeNow.current) resumeRing()
      }
    }
    // `request` is intentionally keyed by rideId: a new request re-announces, a re-render of the same one does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rideId, voiceEnabled, language, prefsReady, player])
}
