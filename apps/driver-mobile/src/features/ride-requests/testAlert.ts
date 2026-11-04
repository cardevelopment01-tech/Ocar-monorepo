import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import * as Speech from 'expo-speech'
import rideAlertSoundAsset from '../../../assets/sounds/ride-request.wav'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import { buildAnnouncement } from './buildAnnouncement'
import { SPEECH_LOCALE } from './useRideAlertSound'
import type { RideRequestPayload } from './types'

const SAMPLE: RideRequestPayload = {
  rideId: 'test', pickup: 'Saheed Nagar, Bhubaneswar', drop: 'Badambadi, Cuttack', pickupLat: 0, pickupLng: 0,
  distanceToPickup: 1200, estimatedFare: 450, rideType: 'one_way', isReturnCab: false, expiresAt: '', timeoutSeconds: 20,
  paymentChannel: 'cash', tripKm: 28, rideCategoryName: 'Sedan',
}

let running: { stop: () => void } | null = null

/** Plays the ring for a moment and reads a sample request, so a driver can check the volume and the voice from Settings. */
export async function playTestAlert(): Promise<void> {
  if (useRideRequestStore.getState().pending) return // never talk over a real request
  running?.stop()
  await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false }).catch(() => {})
  const player = createAudioPlayer(rideAlertSoundAsset)
  player.volume = 1
  player.play()
  const { voiceEnabled, language } = useAlertPrefsStore.getState()
  let done = false
  let spoke = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (done) return
    done = true
    clearTimeout(watchdog)
    if (running?.stop === stop) running = null
    try { player.pause(); player.remove() } catch { /* already released */ }
    if (spoke) Promise.resolve(Speech.stop()).catch(() => {})
  }
  running = { stop }
  watchdog = setTimeout(stop, 15_000) // a speech engine that never calls back must not leave the player behind
  setTimeout(() => {
    if (done) return
    try { player.pause() } catch { /* already released */ }
    if (voiceEnabled) {
      spoke = true
      Speech.speak(buildAnnouncement(SAMPLE, language), { language: SPEECH_LOCALE[language], rate: 0.95, onDone: stop, onStopped: stop, onError: stop })
    } else stop()
  }, 1600)
}
