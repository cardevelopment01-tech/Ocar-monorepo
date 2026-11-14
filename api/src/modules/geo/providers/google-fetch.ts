import { googleCallsTotal, googleApiStatusTotal, type GoogleApi, type GoogleCaller } from '@/observability/google-metrics'

// The `status` values the legacy Google APIs put in a 200 response, as a closed set so the label cannot grow without bound. OK, ZERO_RESULTS
// and NOT_FOUND are normal answers and are not counted; anything else is a failure worth an alert (OVER_QUERY_LIMIT and REQUEST_DENIED
// are the ones that mean the quota or the key). An unknown value counts as OTHER.
const KNOWN_FAILURES = new Set(['OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'REQUEST_DENIED', 'INVALID_REQUEST', 'UNKNOWN_ERROR', 'MAX_ROUTE_LENGTH_EXCEEDED', 'MAX_WAYPOINTS_EXCEEDED'])
const NORMAL = new Set(['OK', 'ZERO_RESULTS', 'NOT_FOUND'])

export function noteGoogleStatus(api: GoogleApi, status: unknown): void {
  if (typeof status !== 'string' || NORMAL.has(status)) return
  googleApiStatusTotal.inc({ api, status: KNOWN_FAILURES.has(status) ? status : 'OTHER' })
}

// Every request to Google Maps Platform goes through here, so each one is counted once and a later daily cap has a single place to live
// (docs/superpowers/plans/2026-11-10-google-maps-cost.md). It adds nothing to the request or the response.
//
// `outcome` is about the HTTP exchange only: the legacy APIs (geocode, autocomplete, place details, directions) answer HTTP 200 with a
// non-OK `status` in the body (for example OVER_QUERY_LIMIT), and those count as ok here. Google bills the request either way. Their
// failures are counted separately by noteGoogleStatus (google_maps_api_status_total).
export async function googleFetch(api: GoogleApi, caller: GoogleCaller, url: string | URL, init?: RequestInit): Promise<Response> {
  let outcome: 'ok' | 'http_error' | 'error' = 'ok'
  try {
    const res = await fetch(url, init)
    if (!res.ok) outcome = 'http_error'
    return res
  } catch (err) {
    outcome = 'error'
    throw err
  } finally {
    googleCallsTotal.inc({ api, caller, outcome })
  }
}
