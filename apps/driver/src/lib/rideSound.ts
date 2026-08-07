import ringtoneUrl from '@/assets/sounds/ride-request.wav'

let audio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(ringtoneUrl)
    audio.loop = true
    audio.preload = 'auto'
  }
  return audio
}

/**
 * Must be called from a real user gesture (the driver's "Go Online" tap).
 * Browsers create every new playback session gated behind a user gesture;
 * doing a muted play/pause here means later calls to `playRideSound()` -
 * triggered by a server socket event, not a gesture - aren't blocked.
 */
export function unlockRideSound(): void {
  const el = getAudio()
  el.muted = true
  el.play()
    .then(() => {
      el.pause()
      el.currentTime = 0
      el.muted = false
    })
    .catch(() => { el.muted = false })
}

export function playRideSound(): void {
  const el = getAudio()
  el.currentTime = 0
  el.play().catch(() => {})
}

export function stopRideSound(): void {
  if (!audio) return
  audio.pause()
  audio.currentTime = 0
}
