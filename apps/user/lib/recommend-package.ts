import type { RentalPackage } from './ride-api'

// Mirror the API's RENTAL_OVERAGE_GRACE_* (api/src/constants/limits.ts): the server only
// bills beyond limit + grace, so the warning must not promise charges inside it.
const GRACE_KM = 2
const GRACE_MIN = 5

export type PackageRecommendation = {
  packageId: number
  /** True when even the largest package can't cover the trip — overage will apply. */
  exceeds: boolean
  overKm: number
  overMin: number
}

/**
 * Smallest (cheapest) package covering both the route distance and drive time.
 * If none fits, the largest package + how far over it the trip runs.
 * The route is a floor, not a ceiling: the rider can go anywhere within the package.
 */
export function recommendPackage(
  packages: RentalPackage[],
  distanceKm: number,
  durationMin: number,
): PackageRecommendation | null {
  if (packages.length === 0) return null
  const fits = packages
    .filter(p => Number(p.km_limit) >= distanceKm && p.duration_minutes >= durationMin)
    .sort((a, b) => Number(a.package_fare) - Number(b.package_fare))[0]
  if (fits) return { packageId: fits.id, exceeds: false, overKm: 0, overMin: 0 }

  const largest = [...packages].sort(
    (a, b) => b.duration_minutes - a.duration_minutes || Number(b.km_limit) - Number(a.km_limit),
  )[0]!
  return {
    packageId: largest.id,
    exceeds: true,
    overKm:  Math.max(0, Math.ceil(distanceKm - Number(largest.km_limit) - GRACE_KM)),
    overMin: Math.max(0, Math.ceil(durationMin - largest.duration_minutes - GRACE_MIN)),
  }
}
