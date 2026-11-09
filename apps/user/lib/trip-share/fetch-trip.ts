import type { FetchResult, PublicTrip } from './types'

/** Reads the public trip. No auth, no cookies, never cached; a bad token or a dead link is "inactive", anything else is "error". */
export async function fetchPublicTrip(
  token: string,
  opts: { baseUrl?: string; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<FetchResult> {
  const base = (opts.baseUrl ?? process.env['NEXT_PUBLIC_API_URL'] ?? '').replace(/\/+$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  try {
    const init: RequestInit = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }
    if (opts.signal) init.signal = opts.signal
    const res = await doFetch(`${base}/api/v1/public/trips/${encodeURIComponent(token)}`, init)
    if (res.status === 404 || res.status === 410) return { kind: 'inactive' }
    if (!res.ok) return { kind: 'error' }
    const body = (await res.json()) as PublicTrip
    if (!body || typeof body.phase !== 'string') return { kind: 'error' }
    return body.phase === 'inactive' ? { kind: 'inactive' } : { kind: 'ok', trip: body }
  } catch {
    return { kind: 'error' }
  }
}
