// Pure function, unit-tested per the Eng review's clock-skew fix: remaining time
// is derived from timeoutSeconds + local receipt timestamp (both taken from the
// same device clock), never from the server's expiresAt compared against the
// local Date.now() directly -- that comparison breaks under device clock skew.
export function computeRemainingSeconds(timeoutSeconds: number, receivedAtMs: number, nowMs: number): number {
  const elapsedSeconds = (nowMs - receivedAtMs) / 1000
  return Math.max(0, timeoutSeconds - elapsedSeconds)
}
