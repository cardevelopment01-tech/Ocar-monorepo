import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/config', () => ({ config: { GOOGLE_MAPS_API_KEY: 'test-key' } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { getRoute } from '@/modules/geo/providers/google.provider'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

const routesBody = {
  routes: [{
    distanceMeters: 12345,
    duration: '1500s',
    staticDuration: '1200s',
    polyline: { encodedPolyline: 'overview' },
    travelAdvisory: {
      speedReadingIntervals: [
        { endPolylinePointIndex: 4, speed: 'NORMAL' },
        { startPolylinePointIndex: 4, endPolylinePointIndex: 9, speed: 'TRAFFIC_JAM' },
        { startPolylinePointIndex: 9, endPolylinePointIndex: 12, speed: 'SPEED_READING_INTERVAL_UNSPECIFIED' },
      ],
    },
    legs: [{
      steps: [
        {
          distanceMeters: 300, polyline: { encodedPolyline: 's1' },
          startLocation: { latLng: { latitude: 20.1, longitude: 85.1 } },
          endLocation: { latLng: { latitude: 20.2, longitude: 85.2 } },
          navigationInstruction: { maneuver: 'TURN_SLIGHT_LEFT', instructions: 'Slight left onto NH16' },
        },
        {
          distanceMeters: 50, polyline: { encodedPolyline: 's2' },
          startLocation: { latLng: { latitude: 20.2, longitude: 85.2 } },
          endLocation: { latLng: { latitude: 20.3, longitude: 85.3 } },
          navigationInstruction: { instructions: 'Destination will be on the right' },
        },
      ],
    }],
  }],
}

describe('google.provider getRoute (Routes API tier)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('maps one Routes API response to distance, ETAs, steps and traffic in a single call', async () => {
    fetchMock.mockResolvedValueOnce(ok(routesBody))
    const r = await getRoute(20, 85, 21, 86, { withSteps: true, trafficAware: true, withTrafficIntervals: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string>; body: string }
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body.routingPreference).toBe('TRAFFIC_AWARE')
    expect(body.extraComputations).toEqual(['TRAFFIC_ON_POLYLINE'])
    expect(init.headers['X-Goog-FieldMask']).toContain('routes.legs.steps.navigationInstruction')
    expect(init.headers['X-Goog-FieldMask']).toContain('routes.travelAdvisory.speedReadingIntervals')

    expect(r).toMatchObject({ source: 'google', distanceKm: 12.3, durationMin: 20, trafficDurationMin: 25, polyline: 'overview' })
    expect(r.steps?.map(s => s.maneuverType)).toEqual(['turn-slight-left', 'arrive'])
    expect(r.steps?.[0]).toMatchObject({ instruction: 'Slight left onto NH16', distanceMetres: 300, endLat: 20.2, polyline: 's1' })
    expect(r.trafficPolyline).toBe('overview')
    expect(r.trafficIntervals).toEqual([
      { startIndex: 0, endIndex: 4, speed: 'NORMAL' },
      { startIndex: 4, endIndex: 9, speed: 'TRAFFIC_JAM' },
    ])
  })

  it('plain distance/ETA read is traffic-unaware with a minimal field mask', async () => {
    fetchMock.mockResolvedValueOnce(ok(routesBody))
    const r = await getRoute(20, 85, 21, 86)

    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string>; body: string }
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE')
    expect(body.extraComputations).toBeUndefined()
    expect(init.headers['X-Goog-FieldMask']).not.toContain('steps')
    expect(r.steps).toBeUndefined()
    expect(r.trafficIntervals).toBeUndefined()
    expect(r.trafficDurationMin).toBeUndefined()
    expect(r.durationMin).toBe(25) // TRAFFIC_UNAWARE: `duration` is the only ETA
  })

  it('falls back to legacy Directions when the Routes API is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
      .mockResolvedValueOnce(ok({
        status: 'OK',
        routes: [{
          overview_polyline: { points: 'legacy' },
          legs: [{ distance: { value: 5000 }, duration: { value: 600 }, steps: [] }],
        }],
      }))
    const r = await getRoute(20, 85, 21, 86)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ source: 'google', polyline: 'legacy', distanceKm: 5, durationMin: 10 })
  })
})
