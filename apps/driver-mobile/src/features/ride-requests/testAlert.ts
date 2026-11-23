import { Alert, Linking, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { getSpeech } from './speech'
import rideAlertSoundAsset from '../../../assets/sounds/ride-request.wav'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { useRideRequestStore } from '@/store/useRideRequestStore'
import { buildAnnouncement, SPEECH_LOCALE } from './buildAnnouncement'
import type { RideRequestPayload } from './types'

const SAMPLE: RideRequestPayload = {
  rideId: 'test', pickup: 'Saheed Nagar, Bhubaneswar', drop: 'Badambadi, Cuttack', pickupLat: 0, pickupLng: 0,
  distanceToPickup: 1200, estimatedFare: 450, rideType: 'one_way', isReturnCab: false, expiresAt: '', timeoutSeconds: 20,
  paymentChannel: 'cash', tripKm: 28, rideCategoryName: 'Sedan',
}

let running: { stop: () => void } | null = null

/** Ends a running Settings test (a real ride request has arrived). */
export function stopTestAlert(): void {
  running?.stop()
}

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
  const stop = () => {
    if (done) return
    done = true
    clearTimeout(watchdog)
    if (running?.stop === stop) running = null
    try { player.pause(); player.remove() } catch { /* already released */ }
    if (spoke) Promise.resolve(getSpeech()?.stop()).catch(() => {})
  }
  running = { stop }
  const watchdog = setTimeout(() => stop(), 15_000) // a speech engine that never calls back must not leave the player behind
  setTimeout(() => {
    if (done) return
    try { player.pause() } catch { /* already released */ }
    const Speech = voiceEnabled ? getSpeech() : null
    if (Speech) {
      spoke = true
      Speech.speak(buildAnnouncement(SAMPLE, language), { language: SPEECH_LOCALE[language], rate: 0.95, onDone: stop, onStopped: stop, onError: stop })
    } else stop()
  }, 1300) // one 1.0 s ring plus a short margin
}

const RING_CHANNEL = 'ride_requests_v3'

/**
 * Rings the same notification channel a ride request uses when Ocar is closed ("Ride requests (loud)", on the alarm volume). It runs with
 * the app open, so it does not test that a push reaches a closed app; it tests what the in-app test above cannot: whether the phone lets
 * that channel make a sound, and how loud the alarm volume is. A channel that is missing or switched off is reported straight away.
 * After a few seconds the test notification is cleared, which also stops its ring, and the driver is asked whether it was loud.
 * It is registered like the in-app test, so tapping again, or a real ride request, ends it first (and cancels its follow-up question).
 */
export async function playTestBackgroundRing(): Promise<void> {
  if (useRideRequestStore.getState().pending) return // never ring over a real request
  if (Platform.OS !== 'android') { await playTestAlert(); return } // channels are an Android thing
  stopTestAlert() // ends a previous run of either test
  const channel = await Notifications.getNotificationChannelAsync(RING_CHANNEL).catch(() => null)
  if (!channel) {
    Alert.alert("Couldn't start the test", 'The ride request notification channel is not set up on this phone. Please check that notifications are allowed for Ocar Driver, then restart the app.', [
      { text: 'Open settings', onPress: () => { void Linking.openSettings() } },
      { text: 'OK', style: 'cancel' },
    ])
    return
  }
  if (channel.importance === Notifications.AndroidImportance.NONE) {
    Alert.alert('Ride request ring is switched off', 'Open the notification settings for Ocar Driver and switch "Ride requests (loud)" on, with sound. Until then a new ride request will not ring when Ocar is in the background.', [
      { text: 'Open settings', onPress: () => { void Linking.openSettings() } },
      { text: 'OK', style: 'cancel' },
    ])
    return
  }
  let id: string
  try {
    id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Test: new ride request',
        body: 'This is how a ride request rings on the loud channel.',
        sound: 'ride_request_long.wav',
        data: { type: 'ring_test' },
      },
      trigger: { channelId: RING_CHANNEL },
    })
  } catch {
    Alert.alert("Couldn't start the test", 'Please check that notifications are allowed for Ocar Driver, then try again.', [
      { text: 'Open settings', onPress: () => { void Linking.openSettings() } },
      { text: 'OK', style: 'cancel' },
    ])
    return
  }
  let done = false
  const stop = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    if (running?.stop === stop) running = null
    Notifications.dismissNotificationAsync(id).catch(() => {})
  }
  running = { stop }
  const timer = setTimeout(() => {
    stop()
    if (useRideRequestStore.getState().pending) return // a real request arrived: do not put a question over it
    Alert.alert(
      'Did it ring loudly?',
      'If you heard nothing or it was quiet: turn up your phone\'s Alarm volume, make sure Do Not Disturb is off, and in Notifications check that "Ride requests (loud)" is switched on with sound.',
      [
        { text: 'Open settings', onPress: () => { void Linking.openSettings() } },
        { text: 'It was loud', style: 'cancel' },
      ],
    )
  }, 5000)
}
