import { useSyncExternalStore } from 'react'

// Pure decision logic for the app-update prompts (docs/superpowers/plans/2026-10-19-app-update-and-rating-flows.md,
// section 5). The server decides soft vs hard (GET /api/v1/app/version-policy); this file decides whether the
// user can be shown it right now.

export type UpdateAction = 'none' | 'soft' | 'hard'
export type UpdateUi = 'hard' | 'soft' | null

export interface VersionPolicy {
  action: UpdateAction
  min_supported: string
  recommended: string
  store_url: string | null
}

export const SOFT_SNOOZE_MS = 72 * 60 * 60 * 1000

export function decideUpdateUi(input: {
  action: UpdateAction
  /** A start-work request just came back 426: show the block at once. */
  forcedHard: boolean
  /** Live ride / online driver / payment: never interrupt. */
  busy: boolean
  snoozedUntil: number
  now: number
}): UpdateUi {
  // A 426 is the answer to something the user just tried to START, so it is never "busy" and must not wait.
  if (input.forcedHard) return 'hard'
  if (input.busy) return null
  if (input.action === 'hard') return 'hard'
  if (input.action === 'soft' && input.now >= input.snoozedUntil) return 'soft'
  return null
}

// Set once any update surface (sheet, hard screen, download pill, restart bar) has appeared: the rating prompt
// stays quiet for the rest of the session so the two never stack.
let updateShown = false
export const markUpdateShown = (): void => { updateShown = true }
export const wasUpdateShownThisSession = (): boolean => updateShown

// The API client lives outside React, so a 426 reaches the gate through this tiny external store.
let forcedHard = false
const listeners = new Set<() => void>()

export function forceHardUpdate(): void {
  if (forcedHard) return
  forcedHard = true
  listeners.forEach((l) => l())
}

export function useForcedHardUpdate(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => forcedHard,
    () => false,
  )
}

/** Test helper. */
export function resetForcedHardUpdate(): void {
  forcedHard = false
  listeners.forEach((l) => l())
}
