import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Google call counter (docs/superpowers/plans/2026-11-10-google-maps-cost.md, phase A): every request to Google is counted once, with a
// closed set of labels, and counting changes nothing about the request or the answer.

vi.mock('@/config', () => ({ config: { GOOGLE_MAPS_API_KEY: 'test-key' } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ getJSON: vi.fn(), setWithTTL: vi.fn().mockResolvedValue(undefined), client: {} }))
vi.mock('@/modules/geo/geo.repository', () => ({}))

import { register } from '@/observability/registry'
import { googleFetch } from '@/modules/geo/providers/google-fetch'
import { getRoute as providerGetRoute, snapToRoads, autocomplete, reverseGeocode, placeDetails } from '@/modules/geo/providers/google.provider'
import * as geoService from '@/modules/geo/geo.service'
import { getJSON } from '@/db/redis'

const res = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body })
const routesBody = { routes: [{ distanceMeters: 5000, duration: '600s', staticDuration: '500s', polyline: { encodedPolyline: 'p' } }] }

async function count(name: string, labels: Record<string, string>): Promise<number> {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === name)
  const hit = (metric?.values as Array<{ value: number; labels: Record<string, string> }> | undefined)
    ?.find((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))
  return hit?.value ?? 0
}

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); register.resetMetrics(); vi.mocked(getJSON).mockResolvedValue(null) })
afterEach(() => vi.unstubAllGlobals())

describe('googleFetch', () => {
  it('counts a successful request once and returns the response untouched', async () => {
    const r = res({ a: 1 })
    fetchMock.mockResolvedValueOnce(r)
    expect(await googleFetch('geocode', 'http', 'https://x.test/a', { method: 'GET' })).toBe(r)
    expect(fetchMock).toHaveBeenCalledWith('https://x.test/a', { method: 'GET' })
    expect(await count('google_maps_calls_total', { api: 'geocode', caller: 'http', outcome: 'ok' })).toBe(1)
  })

  it('counts an HTTP error as http_error and still returns it', async () => {
    fetchMock.mockResolvedValueOnce(res({}, false))
    const r = await googleFetch('roads', 'trail_snap', 'https://x.test/a')
    expect(r.ok).toBe(false)
    expect(await count('google_maps_calls_total', { api: 'roads', outcome: 'http_error' })).toBe(1)
  })

  it('counts a network error or timeout as error and rethrows the same error', async () => {
    const err = new Error('timeout')
    fetchMock.mockRejectedValueOnce(err)
    await expect(googleFetch('directions', 'other', 'https://x.test/a')).rejects.toBe(err)
    expect(await count('google_maps_calls_total', { api: 'directions', outcome: 'error' })).toBe(1)
  })
})

describe('what the provider counts', () => {
  it('labels a Routes call by the features it used and by who asked', async () => {
    fetchMock.mockResolvedValue(res(routesBody))
    await providerGetRoute(1, 1, 2, 2, { caller: 'booking_check' })
    await providerGetRoute(1, 1, 2, 2, { caller: 'eta_snapshot', trafficAware: true })
    await providerGetRoute(1, 1, 2, 2, { caller: 'http', withSteps: true, trafficAware: true, withTrafficIntervals: true })
    expect(await count('google_maps_calls_total', { api: 'routes_traffic_unaware', caller: 'booking_check', outcome: 'ok' })).toBe(1)
    expect(await count('google_maps_calls_total', { api: 'routes_traffic_aware', caller: 'eta_snapshot', outcome: 'ok' })).toBe(1)
    expect(await count('google_maps_calls_total', { api: 'routes_traffic_intervals', caller: 'http', outcome: 'ok' })).toBe(1)
  })

  it('a caller that is not given counts as other', async () => {
    fetchMock.mockResolvedValueOnce(res(routesBody))
    await providerGetRoute(1, 1, 2, 2)
    expect(await count('google_maps_calls_total', { api: 'routes_traffic_unaware', caller: 'other' })).toBe(1)
  })

  it('a Routes failure that falls back to Directions counts both requests', async () => {
    fetchMock
      .mockResolvedValueOnce(res({}, false))                                                                  // Routes API: HTTP 500
      .mockResolvedValueOnce(res({ status: 'OK', routes: [{ overview_polyline: { points: 'q' }, legs: [{ distance: { value: 1000 }, duration: { value: 60 }, steps: [] }] }] }))
    const r = await providerGetRoute(1, 1, 2, 2, { caller: 'dispatch' })
    expect(r.source).toBe('google')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await count('google_maps_calls_total', { api: 'routes_traffic_unaware', caller: 'dispatch', outcome: 'http_error' })).toBe(1)
    expect(await count('google_maps_calls_total', { api: 'directions', caller: 'dispatch', outcome: 'ok' })).toBe(1)
  })

  it('counts the other Google APIs under their own names', async () => {
    fetchMock
      .mockResolvedValueOnce(res({ status: 'OK', predictions: [] }))
      .mockResolvedValueOnce(res({ status: 'OK', result: { formatted_address: 'A', name: 'A', geometry: { location: { lat: 1, lng: 2 } } } }))
      .mockResolvedValueOnce(res({ status: 'OK', results: [{ formatted_address: 'B' }] }))
      .mockResolvedValueOnce(res({ snappedPoints: [] }))
    await autocomplete('bhub')
    await placeDetails('pid')
    await reverseGeocode(1, 2)
    await snapToRoads([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])
    for (const api of ['autocomplete', 'place_details', 'geocode', 'roads']) {
      expect(await count('google_maps_calls_total', { api, outcome: 'ok' }), api).toBe(1)
    }
  })

  it('a snap with too few points makes no request and counts nothing', async () => {
    await snapToRoads([{ lat: 1, lng: 1 }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await count('google_maps_calls_total', { api: 'roads' })).toBe(0)
  })
})

describe('legacy API failures hidden in a 200 response', () => {
  it('counts OVER_QUERY_LIMIT and REQUEST_DENIED, which googleFetch sees as ok', async () => {
    fetchMock
      .mockResolvedValueOnce(res({ status: 'OVER_QUERY_LIMIT', results: [] }))
      .mockResolvedValueOnce(res({ status: 'REQUEST_DENIED', predictions: [] }))
    await reverseGeocode(1, 2)
    await expect(autocomplete('x')).rejects.toThrow()
    expect(await count('google_maps_calls_total', { api: 'geocode', outcome: 'ok' })).toBe(1)
    expect(await count('google_maps_api_status_total', { api: 'geocode', status: 'OVER_QUERY_LIMIT' })).toBe(1)
    expect(await count('google_maps_api_status_total', { api: 'autocomplete', status: 'REQUEST_DENIED' })).toBe(1)
  })

  it('does not count the normal answers, and an unknown status becomes OTHER (the label set stays closed)', async () => {
    fetchMock
      .mockResolvedValueOnce(res({ status: 'ZERO_RESULTS', results: [] }))
      .mockResolvedValueOnce(res({ status: 'OK', results: [{ formatted_address: 'A' }] }))
      .mockResolvedValueOnce(res({ status: 'SOMETHING_NEW_FROM_GOOGLE', results: [] }))
    await reverseGeocode(1, 2); await reverseGeocode(1, 2); await reverseGeocode(1, 2)
    expect(await count('google_maps_api_status_total', { api: 'geocode', status: 'ZERO_RESULTS' })).toBe(0)
    expect(await count('google_maps_api_status_total', { api: 'geocode', status: 'OK' })).toBe(0)
    expect(await count('google_maps_api_status_total', { api: 'geocode', status: 'OTHER' })).toBe(1)
    expect(await count('google_maps_api_status_total', { api: 'geocode', status: 'SOMETHING_NEW_FROM_GOOGLE' })).toBe(0)
  })

  it('a Directions fallback that says over quota is counted, and the route still falls through to OSRM or the straight-line answer', async () => {
    fetchMock
      .mockResolvedValueOnce(res({}, false))                                   // Routes API HTTP error
      .mockResolvedValueOnce(res({ status: 'OVER_QUERY_LIMIT', routes: [] }))  // Directions says quota
      .mockRejectedValueOnce(new Error('osrm down'))                           // OSRM
    const r = await providerGetRoute(1, 1, 2, 2, { caller: 'other' })
    expect(['osrm', 'fallback']).toContain(r.source)
    expect(await count('google_maps_api_status_total', { api: 'directions', status: 'OVER_QUERY_LIMIT' })).toBe(1)
  })
})

describe('route cache counter (geo.service)', () => {
  it('counts a cache hit without calling Google', async () => {
    vi.mocked(getJSON).mockResolvedValueOnce({ distanceKm: 1, durationMin: 1, polyline: 'c', source: 'google' } as never)
    await geoService.getRoute(1, 1, 2, 2, { caller: 'http' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await count('geo_route_cache_total', { result: 'hit', caller: 'http' })).toBe(1)
  })

  it('counts a miss once and joins concurrent identical lookups as coalesced, with one request to Google', async () => {
    let release!: () => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(res(routesBody)) }))
    const a = geoService.getRoute(3, 3, 4, 4, { caller: 'http' })
    await Promise.resolve(); await Promise.resolve()
    const b = geoService.getRoute(3, 3, 4, 4, { caller: 'dispatch' })
    await new Promise((r) => setTimeout(r, 5))
    release()
    await Promise.all([a, b])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await count('geo_route_cache_total', { result: 'miss', caller: 'http' })).toBe(1)
    expect(await count('geo_route_cache_total', { result: 'coalesced', caller: 'dispatch' })).toBe(1)
    expect(await count('google_maps_calls_total', { api: 'routes_traffic_unaware', caller: 'http' })).toBe(1)
  })

  it('the caller is not part of the cache key (a caller change never causes a second Google request)', async () => {
    const { routeKey } = await import('@/constants/redis-keys')
    expect(routeKey(1, 1, 2, 2, { caller: 'http' } as never)).toBe(routeKey(1, 1, 2, 2, { caller: 'dispatch' } as never))
  })
})
