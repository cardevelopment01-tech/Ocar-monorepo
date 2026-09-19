import { useEffect } from 'react'
import { Vibration } from 'react-native'
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio'

// Same asset + same repeating-loop behavior as the web driver app's
// lib/rideSound.ts (playRideSound/stopRideSound) -- ported to expo-audio
// instead of reimplemented, per the plan's reuse-ladder correction.
const RIDE_ALERT_SOUND = require('../../../assets/sounds/ride-request.wav')

// Uber-style pattern: buzz, pause, buzz, repeat -- not a single blip.
const VIBRATION_PATTERN = [0, 400, 200, 400]

let audioModeSet = false

// Must run once before the first play() -- without it, iOS silences the alert
// entirely when the phone's hardware silent switch is on, which defeats the
// entire point of a "must not miss it" ride-request alarm (outside review's
// highest-impact flagged risk).
function ensureAudioMode() {
  if (audioModeSet) return
  audioModeSet = true
  setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(() => {})
}

/** Plays a repeating alert tone + vibration while `active` is true. Stops immediately when it flips to false. */
export function useRideAlertSound(active: boolean): void {
  const player = useAudioPlayer(RIDE_ALERT_SOUND)

  useEffect(() => {
    ensureAudioMode()
    player.loop = true
  }, [player])

  useEffect(() => {
    if (active) {
      player.seekTo(0).catch(() => {})
      player.play()
      Vibration.vibrate(VIBRATION_PATTERN, true)
    } else {
      player.pause()
      Vibration.cancel()
    }
    // Cleanup covers unmount mid-ring (e.g. fast navigation away) so the alarm
    // and vibration never outlive the overlay that triggered them.
    return () => {
      player.pause()
      Vibration.cancel()
    }
  }, [active, player])
}
