import { Counter } from 'prom-client'
import { register } from './registry'

// What the Google Maps bill is made of (docs/superpowers/plans/2026-11-10-google-maps-cost.md, phase A). Label values are a closed set:
// a client can never mint a new one (the caller is set by the server, never read from a request).
//
// api: routes_traffic_unaware | routes_traffic_aware | routes_traffic_intervals | directions | geocode | autocomplete | place_details | roads
//   The routes_* values say which Routes API features the request used. They are not Google's billing tiers: check the SKU report for those.
export type GoogleApi =
  | 'routes_traffic_unaware' | 'routes_traffic_aware' | 'routes_traffic_intervals'
  | 'directions' | 'geocode' | 'autocomplete' | 'place_details' | 'roads'

// caller: http (a client asked) | booking_check | dispatch | eta_snapshot | ride_share | dispute | trail_snap | other
export type GoogleCaller = 'http' | 'booking_check' | 'dispatch' | 'eta_snapshot' | 'ride_share' | 'dispute' | 'trail_snap' | 'other'

export const googleCallsTotal = new Counter({
  name: 'google_maps_calls_total',
  help: 'Requests sent to Google Maps Platform, by API, who asked and how it ended',
  labelNames: ['api', 'caller', 'outcome'], // outcome: ok | http_error | error (network, timeout)
  registers: [register],
})

// The legacy APIs answer HTTP 200 and say "over quota" or "key denied" in the body, which googleFetch cannot see (it counts those as ok).
// This counts them, so a quota or key problem shows up even while google_maps_calls_total keeps rising.
export const googleApiStatusTotal = new Counter({
  name: 'google_maps_api_status_total',
  help: 'Non-OK status answers from the legacy Google Maps APIs (a 200 response whose body reports a failure)',
  labelNames: ['api', 'status'], // status: OVER_QUERY_LIMIT | OVER_DAILY_LIMIT | REQUEST_DENIED | INVALID_REQUEST | UNKNOWN_ERROR | ... | OTHER
  registers: [register],
})

// Attribution: a route lookup that joins one already in flight is counted here as `coalesced` under its own caller, but the single
// request to Google is counted in google_maps_calls_total under the caller that started it. Read the two together.
export const geoRouteCacheTotal = new Counter({
  name: 'geo_route_cache_total',
  help: 'Route lookups by cache result and who asked',
  labelNames: ['result', 'caller'], // result: hit | miss | coalesced (joined a lookup already in flight)
  registers: [register],
})
