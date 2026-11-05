// Pure function, unit-tested per the Eng review's clock-skew fix: remaining time
// is derived from timeoutSeconds + local receipt timestamp (both taken from the
// same device clock), never from the server's expiresAt compared against the
// local Date.now() directly -- that comparison breaks under device clock skew.
export function computeRemainingSeconds(timeoutSeconds: number, receivedAtMs: number, nowMs: number): number {
  const elapsedSeconds = (nowMs - receivedAtMs) / 1000
  return Math.max(0, timeoutSeconds - elapsedSeconds)
}

/** The card slides over whatever the driver was doing (often tapping the map): ignore taps this long after it appears, so
 *  a tap meant for something underneath can never accept or decline a ride. Short enough not to cost a fast driver anything. */
export const TAP_GUARD_MS = 700

/** True once taps on Accept/Decline count. A clock that went backwards (negative elapsed) counts as armed, never as locked. */
export function isTapArmed(receivedAtMs: number, nowMs: number): boolean {
  const elapsed = nowMs - receivedAtMs
  return elapsed < 0 || elapsed >= TAP_GUARD_MS
}
