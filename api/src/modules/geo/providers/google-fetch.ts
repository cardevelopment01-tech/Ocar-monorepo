import { googleCallsTotal, type GoogleApi, type GoogleCaller } from '@/observability/google-metrics'

// Every request to Google Maps Platform goes through here, so each one is counted once and a later daily cap has a single place to live
// (docs/superpowers/plans/2026-11-10-google-maps-cost.md). It adds nothing to the request or the response.
//
// `outcome` is about the HTTP exchange only: the legacy APIs (geocode, autocomplete, place details, directions) answer HTTP 200 with a
// non-OK `status` in the body (for example OVER_QUERY_LIMIT), and those still count as ok here. Google bills the request either way.
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
