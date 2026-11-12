/**
 * What the rider's app is told about return-cab drivers on a route: how many can be offered the ride and how far the nearest one is.
 * The same pickup cap that dispatch applies is used here, so a driver the app counts is a driver the broadcast can actually reach.
 * An unknown distance (null/NaN) never counts: it must not read as a driver standing at the pickup.
 */
export function returnCabAvailability(
  drivers: ReadonlyArray<{ distance_metres: unknown }>,
  capMetres: number,
): { count: number; nearest_m: number | null } {
  const within = drivers
    .map((d) => d.distance_metres)
    .filter((m): m is number => typeof m === 'number' && Number.isFinite(m) && m <= capMetres)
  return { count: within.length, nearest_m: within.length > 0 ? Math.round(Math.min(...within)) : null }
}
