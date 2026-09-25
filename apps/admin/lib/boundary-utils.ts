import type { CityBoundaryGeoJson, CityBoundaryAnalysis } from './boundary-api'

export type PasteResult =
  | { ok: true; polygon: CityBoundaryGeoJson }
  | { ok: false; error: string }

const isPosition = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' &&
  Number.isFinite(p[0]) && Number.isFinite(p[1])

/** Client-side shape gate for the "Paste GeoJSON" box. Only checks structure
 * (so obvious mistakes fail instantly with a clear message) — the server's
 * Zod schema + PostGIS remain the source of truth for validity, region,
 * vertex cap and area (see api admin.types.ts / analyzeCityBoundary). */
export function parsePastedPolygon(text: string): PasteResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Not valid JSON.' }
  }
  // Accept a bare Polygon geometry, or a Feature wrapping one (what most
  // GeoJSON tools — geojson.io, OSM exports — actually emit).
  const geometry =
    typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === 'Feature'
      ? (parsed as { geometry?: unknown }).geometry
      : parsed
  const g = geometry as { type?: unknown; coordinates?: unknown } | null
  if (!g || typeof g !== 'object' || g.type !== 'Polygon' || !Array.isArray(g.coordinates)) {
    return { ok: false, error: 'Must be a GeoJSON Polygon: { "type": "Polygon", "coordinates": [...] }.' }
  }
  const rings = g.coordinates as unknown[]
  if (rings.length !== 1) {
    return { ok: false, error: 'City boundaries are a single outline — holes and multiple rings are not supported.' }
  }
  const ring = rings[0]
  if (!Array.isArray(ring) || ring.length < 3 || !ring.every(isPosition)) {
    return { ok: false, error: 'The ring needs at least 3 [lng, lat] number pairs.' }
  }
  return {
    ok: true,
    // Drop any extra (altitude) ordinates — the API contract is [lng, lat].
    polygon: { type: 'Polygon', coordinates: [(ring as number[][]).map(([lng, lat]) => [lng!, lat!] as [number, number])] },
  }
}

// ~1 cm at Odisha's latitude. The draw library and PostGIS each round
// coordinates (9 dp) their own way, so an untouched shape must not read as "edited".
const COORD_EPSILON = 1e-7

/** True when two boundaries describe the same outline (either may be null =
 * "no boundary"). Compares ring coordinates within COORD_EPSILON. */
export function sameShape(a: CityBoundaryGeoJson | null, b: CityBoundaryGeoJson | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const ra = a.coordinates[0] ?? []
  const rb = b.coordinates[0] ?? []
  return ra.length === rb.length && ra.every((p, i) => Math.abs(p[0] - rb[i]![0]) < COORD_EPSILON && Math.abs(p[1] - rb[i]![1]) < COORD_EPSILON)
}

/** Non-blocking findings a human should acknowledge before saving (design
 * decision 9): overlapping another city, or the city's own centroid falling
 * outside the new shape. Invalid shapes are blocked outright, not warned. */
export function boundaryWarnings(a: CityBoundaryAnalysis | null): string[] {
  if (!a || !a.isValid) return []
  const out = a.overlaps.map(o => `Overlaps ${o.name} (${o.pctOfNew}%)`)
  if (a.centroidInside === false) out.push("This city's own centroid falls outside the shape")
  return out
}
