/**
 * Minutes for a driver `km` away to reach the pickup, at the pace the fare screen has always assumed (30 km/h), never less than 1.
 * One place for it, so a standard car and a return cab are always timed the same way.
 */
export function etaMinFromKm(km: number): number {
  return Math.max(1, Math.round(km / 0.5))
}
