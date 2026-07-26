import { useEffect, useRef } from 'react'

// Alert only above limit + margin, sustained, then stay quiet for a cooldown.
// The sustain window kills GPS spikes without smoothing; the cooldown stops
// nagging (research: Uber/Ola alert on limit+margin with a mute window, not the
// bare limit). Voice-only, so no visual hysteresis is needed — the cooldown
// alone prevents re-triggering while the driver is still over.
const MARGIN_KMPH  = 5
const SUSTAIN_MS   = 5_000
const COOLDOWN_MS  = 45_000

export interface SpeedAlertState {
  overSince:   number | null
  lastAlertAt: number
}

/**
 * Pure decision step, extracted so the timing logic is testable without React.
 * Given the prior state and the latest speed sample at time `now`, returns the
 * next state and whether a voice alert should fire this tick.
 */
export function stepSpeedAlert(
  prev: SpeedAlertState,
  speedKmph: number | null,
  limitKmph: number,
  now: number,
): { state: SpeedAlertState; alert: boolean } {
  if (speedKmph == null) return { state: prev, alert: false }
  const trigger = limitKmph + MARGIN_KMPH
  if (speedKmph < trigger) return { state: { ...prev, overSince: null }, alert: false }

  const overSince = prev.overSince ?? now
  const sustained = now - overSince >= SUSTAIN_MS
  const cooled    = now - prev.lastAlertAt >= COOLDOWN_MS
  if (sustained && cooled) return { state: { overSince, lastAlertAt: now }, alert: true }
  return { state: { ...prev, overSince }, alert: false }
}

/**
 * Plays a spoken "slow down" alert when the driver holds above the posted limit.
 * Reuses the same speechSynthesis pattern as useVoiceGuidance / the arrival
 * announcement (cancel-before-speak for Android Chrome's wedged queue).
 */
export function useSpeedAlert(
  speedKmph: number | null,
  limitKmph: number,
  enabled: boolean,
  language: 'hi' | 'en',
): void {
  const stateRef = useRef<SpeedAlertState>({ overSince: null, lastAlertAt: 0 })

  useEffect(() => {
    if (!enabled) return
    const { state, alert } = stepSpeedAlert(stateRef.current, speedKmph, limitKmph, Date.now())
    stateRef.current = state
    if (!alert) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    // English text with the driver's lang tag — mirrors the arrival announcement
    // in TripInProgress.tsx; no unreviewed multilingual copy is hand-built here.
    const utterance = new SpeechSynthesisUtterance('Please slow down.')
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [speedKmph, limitKmph, enabled, language])
}
