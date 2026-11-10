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

export const geoRouteCacheTotal = new Counter({
  name: 'geo_route_cache_total',
  help: 'Route lookups by cache result and who asked',
  labelNames: ['result', 'caller'], // result: hit | miss | coalesced (joined a lookup already in flight)
  registers: [register],
})
