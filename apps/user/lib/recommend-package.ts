import type { RentalPackage } from './ride-api'

// Best-fit tolerance: a route up to 2 km / 5 min past a package still picks that package instead of jumping to a dearer one.
// It only chooses the package. Billing has no free allowance (api: rentalOverage): every km and minute past the package is
// charged at its extra rates, so the screen shows that extra rather than promising the tolerance is free.
const FIT_GRACE_KM = 2
const FIT_GRACE_MIN = 5

export type PackageRecommendation = {
  packageId: number
  /** True when even the largest package, with the fit tolerance, can't cover the trip. */
  exceeds: boolean
  /** How far the route runs past the recommended package (whole km / minutes). Charged as extra even when it still "fits". */
  overKm: number
  overMin: number
}

/**
 * Cheapest package that fits both the route distance and drive time. A package FITS when the route is within its limit PLUS the
 * fit tolerance (limit + 2 km, + 5 min): a 5.7 km route picks the 5 km package (and pays the 0.7 km extra) rather than the much
 * dearer 10 km one. If none fits, the largest package + how far over it the trip runs.
 * The route is a floor, not a ceiling: the rider can go anywhere within the package.
 */
export function recommendPackage(
  packages: RentalPackage[],
  distanceKm: number,
  durationMin: number,
): PackageRecommendation | null {
  if (packages.length === 0) return null
  const fits = packages
    .filter(p => distanceKm <= Number(p.km_limit) + FIT_GRACE_KM && durationMin <= p.duration_minutes + FIT_GRACE_MIN)
    .sort((a, b) => Number(a.package_fare) - Number(b.package_fare))[0]
  if (fits) return { packageId: fits.id, exceeds: false, ...over(fits, distanceKm, durationMin) }

  const largest = [...packages].sort(
    (a, b) => b.duration_minutes - a.duration_minutes || Number(b.km_limit) - Number(a.km_limit),
  )[0]!
  return { packageId: largest.id, exceeds: true, ...over(largest, distanceKm, durationMin) }
}

// Whole km / minutes past the package, in full: billing charges all of it.
function over(p: Pick<RentalPackage, 'km_limit' | 'duration_minutes'>, distanceKm: number, durationMin: number) {
  return {
    overKm:  Math.max(0, Math.ceil(distanceKm - Number(p.km_limit))),
    overMin: Math.max(0, Math.ceil(durationMin - p.duration_minutes)),
  }
}

export type OverageEstimate = { overKm: number; overMin: number; extra: number }

/**
 * What running past one package would add: every km over x extra_per_km + every minute over x extra_per_min, the same rule the
 * server bills by. A started km or minute counts here, so it is an estimate for the screen, never the booked price.
 */
export function estimateOverage(
  p: Pick<RentalPackage, 'km_limit' | 'duration_minutes' | 'extra_per_km' | 'extra_per_min'>,
  distanceKm: number,
  durationMin: number,
): OverageEstimate {
  const { overKm, overMin } = over(p, distanceKm, durationMin)
  return { overKm, overMin, extra: Math.round(overKm * Number(p.extra_per_km) + overMin * Number(p.extra_per_min)) }
}
