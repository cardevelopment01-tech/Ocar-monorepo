import * as StoreReview from 'expo-store-review'
import { getSecureItem, setSecureItem } from '../storage/secureStorage'
import { isEligibleForReview, type ReviewRole, type ReviewState } from './reviewModel'
import { wasUpdateShownThisSession } from './updateState'

const KEY = 'ocar_review_state'
let promptedThisSession = false

async function load(): Promise<ReviewState> {
  try {
    const raw = await getSecureItem(KEY)
    if (raw) return { firstOpenAt: null, lastPromptAt: null, promptCount: 0, ...(JSON.parse(raw) as Partial<ReviewState>) }
  } catch { /* corrupt or unreadable: start fresh */ }
  return { firstOpenAt: null, lastPromptAt: null, promptCount: 0 }
}

async function save(state: ReviewState): Promise<void> {
  await setSecureItem(KEY, JSON.stringify(state)).catch(() => {})
}

/** Call once per launch (UpdateGate does). The "days since first launch" rule needs it. */
export async function recordFirstOpen(): Promise<void> {
  const state = await load()
  if (state.firstOpenAt === null) await save({ ...state, firstOpenAt: Date.now() })
}

/**
 * Asks the OS to show its native rating card, if the user is eligible. Call at a natural pause after a success
 * (rider: after rating a completed trip; driver: after going offline). The OS decides whether the card really
 * appears and never says whether the user rated, so we record the attempt either way. Never throws.
 */
export async function maybeRequestReview(opts: {
  role: ReviewRole
  getLifetimeRides: () => Promise<number>
  isBusy?: () => boolean
  delayMs?: number
}): Promise<void> {
  try {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
    const state = await load()
    const lifetimeRides = await opts.getLifetimeRides()
    const ok = isEligibleForReview(opts.role, state, {
      now: Date.now(),
      lifetimeRides,
      busy: opts.isBusy?.() ?? false,
      updateShownThisSession: wasUpdateShownThisSession(),
      promptedThisSession,
    })
    if (!ok) return
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return
    promptedThisSession = true
    await save({ ...state, lastPromptAt: Date.now(), promptCount: state.promptCount + 1 })
    await StoreReview.requestReview()
  } catch { /* a rating prompt must never break the screen it runs on */ }
}
