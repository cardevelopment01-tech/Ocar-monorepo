import type { CityBoundaryGeoJson } from './boundary-api'
import { parsePastedPolygon } from './boundary-utils'

// Browser-local draft of an unsaved boundary. Per browser (not per admin, not
// synced across devices) — a server-side draft is a bigger feature we haven't
// needed yet. The baseline is the server's opaque `updatedAt` at the time the
// draft was started, so a later resume can tell if the boundary moved on.

const VERSION = 1
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_BYTES = 500_000 // ~10k vertices is ~250 KB; refuse anything absurd

export interface BoundaryDraft {
  polygon: CityBoundaryGeoJson
  baseUpdatedAt: string
  savedAt: number
}

export const draftKey = (cityId: number) => `ocar_admin_boundary_draft:${cityId}`

// Every storage call can throw (private mode, blocked site data, quota) — a draft
// is a convenience, so failures are reported to the caller, never raised.
export function saveDraft(cityId: number, baseUpdatedAt: string, polygon: CityBoundaryGeoJson): boolean {
  try {
    const raw = JSON.stringify({ v: VERSION, baseUpdatedAt, savedAt: Date.now(), polygon })
    if (raw.length > MAX_BYTES) return false
    localStorage.setItem(draftKey(cityId), raw)
    return true
  } catch {
    return false
  }
}

export function clearDraft(cityId: number): void {
  try { localStorage.removeItem(draftKey(cityId)) } catch { /* nothing to clean */ }
}

/** The saved draft, or null if there is none / it is corrupt / it has expired
 * (corrupt and expired records are removed). */
export function loadDraft(cityId: number): BoundaryDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(cityId))
    if (raw === null) return null
    const rec = JSON.parse(raw) as { v?: unknown; baseUpdatedAt?: unknown; savedAt?: unknown; polygon?: unknown }
    const shape = rec.v === VERSION && typeof rec.baseUpdatedAt === 'string' && typeof rec.savedAt === 'number'
      ? parsePastedPolygon(JSON.stringify(rec.polygon))
      : null
    if (!shape?.ok || Date.now() - (rec.savedAt as number) > DRAFT_MAX_AGE_MS) {
      clearDraft(cityId)
      return null
    }
    return { polygon: shape.polygon, baseUpdatedAt: rec.baseUpdatedAt as string, savedAt: rec.savedAt as number }
  } catch {
    clearDraft(cityId)
    return null
  }
}
