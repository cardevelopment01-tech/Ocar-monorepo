/**
 * Minutes for a driver `km` away to reach the pickup, at the pace the fare screen has always assumed (30 km/h), never less than 1.
 * One place for it, so a standard car and a return cab are always timed the same way.
 */
export function etaMinFromKm(km: number): number {
  return Math.max(1, Math.round(km / 0.5))
}

/** "300 m" under a kilometre (rounded to 100 m, never "0 m" or "1000 m"), else "3.1 km". */
export function formatNearestKm(km: number): string {
  const m = Math.max(100, Math.round((km * 1000) / 100) * 100)
  return m >= 1000 ? `${(Math.round(km * 10) / 10).toFixed(1)} km` : `${m} m`
}
