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
 * Browsers gate autoplay per-origin, not per-element, so a muted play/pause
 * on a throwaway element unlocks later `playRideSound()` calls just as well -
 * and, unlike reusing the ringtone's own element, can't stop a ringtone that
 * happens to already be playing when this fires.
 */
export function unlockRideSound(): void {
  const el = new Audio(ringtoneUrl)
  el.muted = true
  el.play()
    .then(() => el.pause())
    .catch(() => {})
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
