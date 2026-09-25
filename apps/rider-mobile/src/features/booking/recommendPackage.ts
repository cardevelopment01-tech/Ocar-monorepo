import type { RentalPackage } from '@ocar/mobile-shared'

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

// Mirrors apps/user/lib/recommend-package.ts (web). The route is a floor, not a
// ceiling: the rider can go anywhere within the package.
export function recommendPackage(
  packages: RentalPackage[],
  distanceKm: number,
  durationMin: number,
): PackageRecommendation | null {
  if (packages.length === 0) return null
  const fits = packages
    .filter((p) => p.kmLimit >= distanceKm && p.durationMinutes >= durationMin)
    .sort((a, b) => a.packageFare - b.packageFare)[0]
  if (fits) return { packageId: fits.id, exceeds: false, overKm: 0, overMin: 0 }

  const largest = [...packages].sort(
    (a, b) => b.durationMinutes - a.durationMinutes || b.kmLimit - a.kmLimit,
  )[0]!
  return {
    packageId: largest.id,
    exceeds: true,
    overKm: Math.max(0, Math.ceil(distanceKm - largest.kmLimit - GRACE_KM)),
    overMin: Math.max(0, Math.ceil(durationMin - largest.durationMinutes - GRACE_MIN)),
  }
}
