// Telemetry must never carry a location or a phone number. Ocar's API puts coordinates
// and search text in query strings (geo, pricing, ride lookups), so every URL that leaves
// the device is cut at the "?". Path ids stay: they are what make an error traceable.
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

// Collapse numeric path segments so PostHog groups /rides/519 and /rides/520 as one route.
export function routeOf(url: string): string {
  return scrubUrl(url).replace(/^https?:\/\/[^/]+/, '').replace(/\/\d+/g, '/:id')
}

export function userKey(role: 'driver' | 'rider', id: string | number | bigint): string {
  return `${role}:${id}`
}

export const SLOW_MS = 3000

// What a finished API call is worth reporting as. 404 is ignored: "no active ride" and similar are normal answers.
export function classifyApiCall(status: number | null, ms: number): 'ok' | 'slow' | 'ignore' | 'error' | 'server_error' {
  if (status !== null && status >= 200 && status < 400) return ms >= SLOW_MS ? 'slow' : 'ok'
  if (status === 404) return 'ignore'
  return status !== null && status >= 500 ? 'server_error' : 'error'
}
