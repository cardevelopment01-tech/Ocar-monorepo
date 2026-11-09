// The "N km" next to a place in the search lists. Google's place search only knows the straight-line distance from the pickup, and a
// rider compares it with the road distance other apps show (and with our own fare screen), so the straight line is scaled up to a road
// estimate and written with a "~". Real road distance for every suggestion would cost a routing call per row per search (about $5 per
// 1,000 rows), which is why it is an estimate; the fare screen shows the real one once a place is picked.

/**
 * How much longer a road is than the straight line. Measured on five Bhubaneswar / Cuttack pairs: 1.21 to 1.32 (mean 1.25). 1.3 is also the
 * factor the API's routing fallback uses (api/src/modules/geo/providers/google.provider.ts), so the two agree.
 */
export const ROAD_FACTOR = 1.3

/** Road-distance estimate in km for a straight-line distance in metres. */
export const estimatedRoadKm = (straightMetres: number): number => (straightMetres / 1000) * ROAD_FACTOR

/** "~10.4 km" for a straight-line 8 km. */
export const formatEstimatedRoadKm = (straightMetres: number): string => `~${estimatedRoadKm(straightMetres).toFixed(1)} km`
