import { config } from '@/config'

const BASE = 'https://maps.googleapis.com/maps/api'

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

export type RouteResult = {
  distanceKm: number
  durationMin: number
  polyline: string
}

async function gmapsGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('key', config.GOOGLE_MAPS_API_KEY)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw Object.assign(new Error('Google Maps request failed'), { statusCode: 502 })
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
    throw Object.assign(new Error(`Autocomplete: ${body.status}`), { statusCode: 502 })
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
    throw Object.assign(new Error('Maps not configured'), { statusCode: 503 })
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
    throw Object.assign(new Error(`Place details: ${body.status}`), { statusCode: 502 })
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

export async function getRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<RouteResult> {
  if (!config.GOOGLE_MAPS_API_KEY) {
    return haversineFallback(originLat, originLng, destLat, destLng)
  }

  const body = await gmapsGet('/directions/json', {
    origin: `${originLat},${originLng}`,
    destination: `${destLat},${destLng}`,
    mode: 'driving',
    language: 'en',
  }) as {
    status: string
    routes: Array<{
      overview_polyline: { points: string }
      legs: Array<{ distance: { value: number }; duration: { value: number } }>
    }>
  }

  if (body.status !== 'OK') {
    return haversineFallback(originLat, originLng, destLat, destLng)
  }

  const leg = body.routes[0]!.legs[0]!
  return {
    distanceKm: Math.round((leg.distance.value / 1000) * 10) / 10,
    durationMin: Math.round(leg.duration.value / 60),
    polyline: body.routes[0]!.overview_polyline.points,
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
  return { distanceKm, durationMin: Math.round(distanceKm / 0.5), polyline: '' }
}
