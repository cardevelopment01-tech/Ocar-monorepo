import { useEffect, useRef } from 'react'
import type { RouteStep } from './ride-api'

// Mirrors api/src/constants/limits.ts MANEUVER_ANNOUNCE_FAR/NEAR_METRES.
const ANNOUNCE_FAR_METRES = 300
const ANNOUNCE_NEAR_METRES = 100

type Threshold = 'far' | 'near'

/**
 * Speaks the current maneuver's instruction (already localized by the backend's
 * `language` param — no distance-prefix sentence is hand-built here, to avoid
 * fabricating unreviewed multilingual phrasing) as the driver crosses two distance
 * bands, so it's announced once with room to react and again just before the turn.
 */
export function useVoiceGuidance(
  currentStep: RouteStep | null,
  distanceToManeuver: number | null,
  enabled: boolean,
  language: 'hi' | 'en',
): void {
  const announcedForStep = useRef<Set<Threshold>>(new Set())
  const lastStepKey = useRef<string | null>(null)

  useEffect(() => {
    const key = currentStep ? `${currentStep.maneuverType}:${currentStep.endLat}:${currentStep.endLng}` : null
    if (key !== lastStepKey.current) {
      lastStepKey.current = key
      announcedForStep.current = new Set()
    }
  }, [currentStep])

  useEffect(() => {
    if (!enabled || !currentStep || distanceToManeuver == null) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    const announced = announcedForStep.current
    let threshold: Threshold | null = null
    if (distanceToManeuver <= ANNOUNCE_NEAR_METRES && !announced.has('near')) {
      threshold = 'near'
    } else if (distanceToManeuver <= ANNOUNCE_FAR_METRES && !announced.has('far')) {
      threshold = 'far'
    }
    if (!threshold) return
    // 'near' supersedes 'far' — if the first fix for this step already lands inside
    // the near band, don't also queue a redundant far announcement right after.
    announced.add(threshold)
    announced.add('far')

    const utterance = new SpeechSynthesisUtterance(currentStep.instruction)
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
    // Android Chrome's utterance queue is known to wedge after long idle periods —
    // always clear it before speaking (docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md item 5).
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [currentStep, distanceToManeuver, enabled, language])
}
