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

// All read-modify-write on KEY goes through this queue so two callers can never overwrite each other's update.
let chain: Promise<unknown> = Promise.resolve()
function mutate<T>(fn: (state: ReviewState) => Promise<{ state: ReviewState; result: T }> | { state: ReviewState; result: T }): Promise<T> {
  const run = chain.then(async () => {
    const { state, result } = await fn(await load())
    await save(state)
    return result
  })
  chain = run.catch(() => {})
  return run
}

/** Call once per launch (UpdateGate does). The "days since first launch" rule needs it. */
export async function recordFirstOpen(): Promise<void> {
  await mutate((state) => ({ state: state.firstOpenAt === null ? { ...state, firstOpenAt: Date.now() } : state, result: undefined })).catch(() => {})
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
    const facts = (lifetimeRides: number) => ({
      now: Date.now(),
      lifetimeRides,
      busy: opts.isBusy?.() ?? false,
      updateShownThisSession: wasUpdateShownThisSession(),
      promptedThisSession,
    })
    // Cheap local gate first (rides assumed sufficient): skips the stats network call once capped or cooling down.
    if (!isEligibleForReview(opts.role, await mutate((s) => ({ state: s, result: s })), facts(Infinity))) return
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return
    const lifetimeRides = await opts.getLifetimeRides()
    const ok = await mutate((state) => {
      const eligible = isEligibleForReview(opts.role, state, facts(lifetimeRides))
      return eligible
        ? { state: { ...state, lastPromptAt: Date.now(), promptCount: state.promptCount + 1 }, result: true }
        : { state, result: false }
    })
    if (!ok) return
    promptedThisSession = true
    await StoreReview.requestReview()
  } catch { /* a rating prompt must never break the screen it runs on */ }
}
