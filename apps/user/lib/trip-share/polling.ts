// How often the page asks for a fresh position. The server answers from a 2 s cache and limits each link to 180 requests a
// minute, so 5 s per viewer is cheap; a page left open for a long time slows down, and a failing network backs off.

export const POLL_MS = 5_000
export const SLOW_POLL_MS = 15_000
/** After the trip has ended there is nothing to follow; a slow poll is only there to notice the link going dead. */
export const ENDED_POLL_MS = 30_000
export const SLOW_AFTER_MS = 10 * 60 * 1000
export const MAX_BACKOFF_MS = 60_000

export interface PollState {
  /** Milliseconds this page has been watching. */
  watchedMs: number
  /** Consecutive failed requests (0 after a success). */
  failures: number
  /** The trip is over (completed or cancelled). */
  ended: boolean
}

export function nextDelayMs(s: PollState): number {
  const base = s.ended ? ENDED_POLL_MS : s.watchedMs >= SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS
  if (s.failures <= 0) return base
  // 5 s, 10 s, 20 s ... up to a minute, never faster than the normal pace.
  return Math.min(MAX_BACKOFF_MS, Math.max(base, POLL_MS * 2 ** Math.min(s.failures, 6)))
}
