import { api } from '@/services/api'
import { track } from '@ocar/mobile-shared'
import { FALLBACK_TERMS, type AdvanceTerms, type CancelPreview } from './advanceModel'

let cachedTerms: { at: number; terms: AdvanceTerms } | null = null
const TERMS_TTL_MS = 5 * 60_000

/** The advance-booking terms (lead time, limits, late-cancel fee). Cached for a few minutes; falls back to the long-standing defaults if the server is unreachable or older. */
export async function fetchAdvanceTerms(): Promise<AdvanceTerms> {
  if (cachedTerms && Date.now() - cachedTerms.at < TERMS_TTL_MS) return cachedTerms.terms
  try {
    const res = await api.get<AdvanceTerms>('/api/v1/rides/advance-policy')
    cachedTerms = { at: Date.now(), terms: { ...FALLBACK_TERMS, ...res.data } }
    return cachedTerms.terms
  } catch {
    return cachedTerms?.terms ?? FALLBACK_TERMS
  }
}

/** The exact cost of cancelling now, for the confirm sheet. Throws on failure: the caller decides how to word a missing preview. */
export async function fetchCancelPreview(rideId: string): Promise<CancelPreview> {
  return (await api.get<CancelPreview>(`/api/v1/rides/${rideId}/cancel-preview`)).data
}

/** Moves the pickup of a ride that has not started dispatch. Free; the server enforces the per-booking limit. */
export async function rescheduleRide(rideId: string, scheduledForIso: string): Promise<{ scheduledFor: string; reschedulesLeft: number | null }> {
  const res = await api.patch<{ scheduledFor: string; reschedulesLeft: number | null }>(`/api/v1/rides/${rideId}/schedule`, { scheduledFor: scheduledForIso })
  track('ride_rescheduled', {})
  return res.data
}

/** The API's machine-readable error code (e.g. RESCHEDULE_LIMIT) from a failed request, if there is one. */
export function apiErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code as string | undefined
}
