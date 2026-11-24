// A driver whose last location fix is older than this is shown as "last seen" on the live map instead of as live.
// Matches the server's silent-driver page (api/src/modules/rides/silent-drivers.ts, 3 min).
export const STALE_AFTER_MS = 3 * 60_000

export function isStale(updatedAt: string | null | undefined, nowMs: number): boolean {
  if (!updatedAt) return true
  const t = new Date(updatedAt).getTime()
  return Number.isNaN(t) || nowMs - t > STALE_AFTER_MS
}
