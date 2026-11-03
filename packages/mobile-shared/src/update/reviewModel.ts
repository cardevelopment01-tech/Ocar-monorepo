// Pure eligibility rules for the native "rate the app" prompt (plan section 5.6). Objective success signals only:
// no "do you like the app?" question first and no filtering on how happy the user is, which both stores forbid.

export interface ReviewState {
  firstOpenAt: number | null
  lastPromptAt: number | null
  promptCount: number
}

export type ReviewRole = 'rider' | 'driver'

const DAY_MS = 24 * 60 * 60 * 1000

export const REVIEW_RULES = {
  rider: { minRides: 3, minDays: 7 },
  driver: { minRides: 10, minDays: 14 },
  cooldownDays: 120,
  maxPrompts: 3,
} as const

export function isEligibleForReview(
  role: ReviewRole,
  state: ReviewState,
  facts: { now: number; lifetimeRides: number; busy: boolean; updateShownThisSession: boolean; promptedThisSession: boolean },
): boolean {
  const rule = REVIEW_RULES[role]
  if (facts.busy || facts.updateShownThisSession || facts.promptedThisSession) return false
  if (facts.lifetimeRides < rule.minRides) return false
  if (state.firstOpenAt === null || facts.now - state.firstOpenAt < rule.minDays * DAY_MS) return false
  if (state.promptCount >= REVIEW_RULES.maxPrompts) return false
  if (state.lastPromptAt !== null && facts.now - state.lastPromptAt < REVIEW_RULES.cooldownDays * DAY_MS) return false
  return true
}
