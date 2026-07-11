import { config } from '@/config'

const BASE = 'https://maps.googleapis.com/maps/api'
const ROUTES_API_BASE = 'https://routes.googleapis.com/directions/v2:computeRoutes'

export type PlaceSuggestion = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

export type PlaceDetail = {
  placeId: string
  address: string
  lat: number
  lng: number
}

export type RouteStep = {
  /** Plain text (HTML stripped), used both as banner text and TTS input. */
  instruction: string
  distanceMetres: number
  /** Google's own maneuver vocabulary (turn-left, roundabout-right, ...), or 'straight'/'arrive'. */
  maneuverType: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  /** Encoded polyline for just this step's road geometry — decode with the same
   *  algorithm as the overview polyline. Needed to tell which step a driver is on
   *  when the road curves between start/end, not just a straight-line guess. */
  polyline: string
}

export type TrafficSpeed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM'

export type TrafficInterval = {
  /** Point indices into `trafficPolyline` (not `polyline` — a separately-fetched
   *  route from the Routes API, whose geometry may not exactly match Directions'). */
  startIndex: number
  endIndex: number
  speed: TrafficSpeed
}

export type RouteResult = {
  distanceKm: number
  durationMin: number
  polyline: string
  /** Which tier produced this result — 'google' has real steps/traffic; 'osrm' is a
   *  road-snapped line with no turn-by-turn/voice/traffic; 'fallback' is a straight
   *  line, no real road geometry. Lets the frontend flag a degraded state instead of
   *  silently looking like "no route needed" when Google Directions is unreachable. */
  source: 'google' | 'osrm' | 'fallback'
  /** Present only when the request set trafficAware and Google returned live-traffic data. */
  trafficDurationMin?: number
  /** Present only when the request set withSteps. */
  steps?: RouteStep[]
  /** Congestion segments for rendering a traffic-tinted route line. Present only when
   *  trafficAware was requested and the Routes API returned traffic data. Indices refer
   *  to `trafficPolyline`, decoded separately — NOT to `polyline` above. */
  trafficIntervals?: TrafficInterval[]
  trafficPolyline?: string
}

export type RouteOptions = {
  language?: string
  withSteps?: boolean
  trafficAware?: boolean
  /** Also fetch congestion segments for a traffic-tinted route line (a second,
   *  separate Routes API call — see getTrafficIntervals). Keep this off for
   *  server-side-only ETA reads (e.g. rides.service.ts's logEtaSnapshot) that
   *  only need trafficDurationMin/durationMin, so they don't pay for a second
   *  API call whose result they never use. */
  withTrafficIntervals?: boolean
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

async function gmapsGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('key', config.GOOGLE_MAPS_API_KEY)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw Object.assign(new Error('Google Maps request failed'), { httpStatus: 502 })
  return res.json()
}

export async function autocomplete(
  input: string,
  lat?: number,
  lng?: number,
): Promise<PlaceSuggestion[]> {
  if (!config.GOOGLE_MAPS_API_KEY) return []

  const params: Record<string, string> = {
    input,
    components: 'country:in',
    language: 'en',
  }
  if (lat !== undefined && lng !== undefined) {
    params['location'] = `${lat},${lng}`
    params['radius'] = '200000'
  } else {
    params['location'] = '20.9517,85.0985'
    params['radius'] = '300000'
  }

  const data = gmapsGet('/place/autocomplete/json', params) as Promise<{
    status: string
    predictions: Array<{
      place_id: string
      description: string
      structured_formatting?: { main_text: string; secondary_text: string }
    }>
  }>

  const body = await data
  if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    throw Object.assign(new Error(`Autocomplete: ${body.status}`), { httpStatus: 502 })
  }

  return (body.predictions ?? []).map(p => ({
    placeId: p.place_id,
    description: p.description,
    mainText: p.structured_formatting?.main_text ?? p.description,
    secondaryText: p.structured_formatting?.secondary_text ?? '',
  }))
}

export async function placeDetails(placeId: string): Promise<PlaceDetail> {
  if (!config.GOOGLE_MAPS_API_KEY) {
    throw Object.assign(new Error('Maps not configured'), { httpStatus: 503 })
  }

  const body = await gmapsGet('/place/details/json', {
    place_id: placeId,
    fields: 'geometry,name,formatted_address',
    language: 'en',
  }) as {
    status: string
    result: {
      formatted_address: string
      name: string
      geometry: { location: { lat: number; lng: number } }
    }
  }

  if (body.status !== 'OK') {
    throw Object.assign(new Error(`Place details: ${body.status}`), { httpStatus: 502 })
  }

  return {
    placeId,
    address: body.result.formatted_address ?? body.result.name,
    lat: body.result.geometry.location.lat,
    lng: body.result.geometry.location.lng,
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  if (!config.GOOGLE_MAPS_API_KEY) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`

  const body = await gmapsGet('/geocode/json', {
    latlng: `${lat},${lng}`,
    language: 'en',
  }) as { status: string; results: Array<{ formatted_address: string }> }

  if (body.status !== 'OK') return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  return body.results?.[0]?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

// Separate call to the newer Routes API purely for per-segment congestion data —
// the legacy Directions API used above for turn-by-turn steps has no equivalent
// field. Best-effort only: on any failure, callers just get no traffic tinting,
// never an error, since this is a cosmetic overlay on top of the real route.
async function getTrafficIntervals(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  language: string,
): Promise<{ polyline: string; intervals: TrafficInterval[] } | null> {
  if (!config.GOOGLE_MAPS_API_KEY) return null
  try {
    const res = await fetch(ROUTES_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals',
      },
      body: JSON.stringify({
        origin:            { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination:        { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode:         'DRIVE',
        routingPreference:  'TRAFFIC_AWARE',
        extraComputations:  ['TRAFFIC_ON_POLYLINE'],
        languageCode:       language,
        units:              'METRIC',
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const body = await res.json() as {
      routes?: Array<{
        polyline?: { encodedPolyline?: string }
        travelAdvisory?: {
          speedReadingIntervals?: Array<{
            startPolylinePointIndex?: number
            endPolylinePointIndex?: number
            speed?: string
          }>
        }
      }>
    }

    const route = body.routes?.[0]
    const encoded = route?.polyline?.encodedPolyline
    const rawIntervals = route?.travelAdvisory?.speedReadingIntervals
    if (!encoded || !rawIntervals?.length) return null

    const intervals: TrafficInterval[] = rawIntervals
      .filter((i): i is typeof i & { speed: TrafficSpeed } =>
        i.speed === 'NORMAL' || i.speed === 'SLOW' || i.speed === 'TRAFFIC_JAM')
      .map(i => ({
        startIndex: i.startPolylinePointIndex ?? 0,
        endIndex:   i.endPolylinePointIndex ?? 0,
        speed:      i.speed,
      }))
    if (!intervals.length) return null

    return { polyline: encoded, intervals }
  } catch {
    return null
  }
}

export async function getRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  opts?: RouteOptions,
): Promise<RouteResult> {
  // 1. Try Google Directions (best quality, needs key + Directions API enabled)
  if (config.GOOGLE_MAPS_API_KEY) {
    try {
      const params: Record<string, string> = {
        origin:      `${originLat},${originLng}`,
        destination: `${destLat},${destLng}`,
        mode:        'driving',
        language:    opts?.language ?? 'en',
      }
      if (opts?.trafficAware) params['departure_time'] = 'now'

      const body = await gmapsGet('/directions/json', params) as {
        status: string
        routes: Array<{
          overview_polyline: { points: string }
          legs: Array<{
            distance: { value: number }
            duration: { value: number }
            duration_in_traffic?: { value: number }
            steps: Array<{
              html_instructions: string
              distance: { value: number }
              maneuver?: string
              start_location: { lat: number; lng: number }
              end_location: { lat: number; lng: number }
              polyline: { points: string }
            }>
          }>
        }>
      }

      if (body.status === 'OK' && body.routes[0]) {
        const leg = body.routes[0].legs[0]!
        const result: RouteResult = {
          distanceKm: Math.round((leg.distance.value / 1000) * 10) / 10,
          durationMin: Math.round(leg.duration.value / 60),
          polyline: body.routes[0].overview_polyline.points,
          source: 'google',
        }
        if (leg.duration_in_traffic) {
          result.trafficDurationMin = Math.round(leg.duration_in_traffic.value / 60)
        }
        if (opts?.withSteps) {
          const lastIdx = leg.steps.length - 1
          result.steps = leg.steps.map((s, i) => ({
            instruction: stripHtml(s.html_instructions),
            distanceMetres: s.distance.value,
            maneuverType: s.maneuver ?? (i === lastIdx ? 'arrive' : 'straight'),
            startLat: s.start_location.lat,
            startLng: s.start_location.lng,
            endLat: s.end_location.lat,
            endLng: s.end_location.lng,
            polyline: s.polyline.points,
          }))
        }
        if (opts?.withTrafficIntervals) {
          const traffic = await getTrafficIntervals(originLat, originLng, destLat, destLng, opts?.language ?? 'en')
          if (traffic) {
            result.trafficPolyline = traffic.polyline
            result.trafficIntervals = traffic.intervals
          }
        }
        return result
      }
    } catch { /* fall through to OSRM */ }
  }

  // 2. OSRM fallback — free, no key, real road geometry via OpenStreetMap
  try {
    return await osrmRoute(originLat, originLng, destLat, destLng)
  } catch { /* fall through to haversine */ }

  // 3. Last resort — straight-line estimate, no polyline
  return haversineFallback(originLat, originLng, destLat, destLng)
}

// OSRM public demo server — returns Google-compatible encoded polyline
async function osrmRoute(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): Promise<RouteResult> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${lng1},${lat1};${lng2},${lat2}` +
    `?overview=full&geometries=polyline`

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('OSRM HTTP error')

  const data = await res.json() as {
    code: string
    routes: Array<{ distance: number; duration: number; geometry: string }>
  }

  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('OSRM no route')

  const route = data.routes[0]
  return {
    distanceKm: Math.round((route.distance / 1000) * 10) / 10,
    durationMin: Math.round(route.duration / 60),
    polyline: route.geometry,
    source: 'osrm',
  }
}

function haversineFallback(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): RouteResult {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  const straightKm = R * 2 * Math.asin(Math.sqrt(a))
  const distanceKm = Math.round(straightKm * 1.3 * 10) / 10
  return { distanceKm, durationMin: Math.round(distanceKm / 0.5), polyline: '', source: 'fallback' }
}
