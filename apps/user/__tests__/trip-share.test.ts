import { describe, expect, it, vi } from 'vitest'
import { LANGS, STRINGS, pickLanguage, t, type StringKey } from '../lib/trip-share/i18n'
import { driverAgeSec, formatAgo, headline, mapLabel, statusView, vehicleLine } from '../lib/trip-share/status'
import { ENDED_POLL_MS, MAX_BACKOFF_MS, POLL_MS, SLOW_AFTER_MS, SLOW_POLL_MS, nextDelayMs } from '../lib/trip-share/polling'
import { MAX_GLIDE_MS, MIN_GLIDE_MS, lerpPosition, planGlide } from '../lib/trip-share/glide'
import { fetchPublicTrip } from '../lib/trip-share/fetch-trip'
import { installMapsErrorFilter, isMapsRejection, isMapsScriptError } from '../lib/trip-share/maps-error-filter'
import type { PublicTrip } from '../lib/trip-share/types'

// Value: protects=what a worried relative reads on the public trip page (wording, stale vs live, the three languages) and how
// the page behaves over time (polling pace, glide vs snap, dead links); fails_when=a string is missing in a language, a stale
// position is shown as live, polling speeds up on failure, or a 404/410 is treated as a network error; why_new=new public page;
// seam=none (pure rules, fetch injected); no_claim=rendering, the map, or the real API.
const T0 = Date.parse('2026-11-06T10:00:00Z')
const fmt = (d: Date) => `T${d.toISOString().slice(11, 16)}`
const trip = (over: Partial<PublicTrip> = {}): PublicTrip => ({
  phase: 'in_trip', isSos: false, riderFirstName: 'Rahul', driverFirstName: 'Suresh',
  vehicle: { color: 'White', brand: 'Maruti', model: 'Dzire', plate: 'OD02AB1234' },
  pickup: { label: 'Patia', lat: 20.35, lng: 85.82 }, drop: { label: 'Airport', lat: 20.24, lng: 85.81 }, stops: [],
  driver: { lat: 20.3, lng: 85.8, heading: 90, updatedAt: new Date(T0 - 5_000).toISOString(), stale: false },
  etaMin: 12, route: 'poly', completedAt: null, serverTime: new Date(T0).toISOString(), ...over,
})
const view = (p: PublicTrip, nowMs = T0, lang: 'en' | 'hi' | 'or' = 'en') => statusView({ trip: p, lang, receivedAtMs: T0, nowMs, formatTime: fmt })

describe('arrival line', () => {
  it('is the ETA a relative came for: a clock time in a trip, minutes to pickup on the way, nothing when stale or unknown', () => {
    expect(view(trip()).eta).toBe('Arriving T10:12')
    expect(view(trip({ phase: 'driver_on_way', etaMin: 6 })).eta).toBe('Reaches pickup in 6 min')
    expect(view(trip({ etaMin: null })).eta).toBeNull()
    expect(view(trip(), T0 + 130_000).eta).toBeNull() // stale: do not promise a time off an old position
    expect(view(trip({ phase: 'completed', driver: null })).eta).toBeNull()
  })
})

describe('languages', () => {
  const keys = Object.keys(STRINGS.en) as StringKey[]
  it.each(LANGS.map((l) => l.code))('%s has every string', (lang) => {
    for (const k of keys) expect(STRINGS[lang][k], `${lang}:${k}`).toBeTruthy()
    expect(Object.keys(STRINGS[lang]).sort()).toEqual([...keys].sort())
  })
  it('every language keeps exactly the placeholders of the English string', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const lang of ['hi', 'or'] as const) for (const k of keys) expect(ph(STRINGS[lang][k]), `${lang}:${k}`).toBe(ph(STRINGS.en[k]))
  })
  it('fills placeholders and leaves unknown ones visible rather than hiding a bug', () => {
    expect(t('en', 'status.onWayEta', { min: 4 })).toBe('On the way to pickup · 4 min')
    expect(t('en', 'headline.named', {})).toBe('{name} is on a trip')
  })
  it('picks ?lang= first, then the saved choice, then the browser, then English', () => {
    expect(pickLanguage({ queryLang: 'or', stored: 'hi', browserLanguages: ['en-IN'] })).toBe('or')
    expect(pickLanguage({ queryLang: 'xx', stored: 'hi', browserLanguages: ['en-IN'] })).toBe('hi')
    expect(pickLanguage({ stored: null, browserLanguages: ['fr-FR', 'or-IN', 'en'] })).toBe('or')
    expect(pickLanguage({ browserLanguages: ['hi-IN'] })).toBe('hi')
    expect(pickLanguage({})).toBe('en')
  })
})

describe('statusView', () => {
  it('on the way: info tone, ETA in minutes, freshness from the server clock', () => {
    const v = view(trip({ phase: 'driver_on_way' }))
    expect(v).toMatchObject({ tone: 'info', text: 'On the way to pickup · 12 min', stale: false, freshness: 'Updated 5 sec ago' })
  })
  it('in trip: success tone and the arrival time the viewer will recognise', () => {
    const v = view(trip())
    expect(v).toMatchObject({ tone: 'success', text: `In trip · Arriving ${fmt(new Date(T0 + 12 * 60_000))}` })
  })
  it('the arrival time does not creep later as the page sits there (it is anchored to the server time, not the ticking clock)', () => {
    const first = view(trip()).text
    expect(view(trip(), T0 + 30_000).text).toBe(first)
    expect(view(trip(), T0 + 50_000).text).toBe(first)
  })
  it('a ride being re-dispatched says a new driver is being found, and is not a dead link', () => {
    expect(view(trip({ phase: 'finding_driver', driver: null, etaMin: null }))).toMatchObject({ tone: 'info', text: 'Finding a new driver…', freshness: null, stale: false })
    expect(view(trip({ phase: 'finding_driver', driver: null, etaMin: null }), T0, 'hi').text).toBe('नया ड्राइवर ढूँढा जा रहा है…')
  })
  it('without an ETA it just names the phase', () => {
    expect(view(trip({ etaMin: null })).text).toBe('In trip')
    expect(view(trip({ phase: 'driver_on_way', etaMin: null })).text).toBe('On the way to pickup')
  })
  it('a position older than 60 s (by the server clock plus the time since it arrived) is stale, never live', () => {
    const old = trip({ driver: { lat: 1, lng: 1, heading: null, updatedAt: new Date(T0 - 100_000).toISOString(), stale: true } })
    expect(view(old)).toMatchObject({ tone: 'warning', stale: true, text: 'In trip', freshness: 'Last seen 1 min ago' })
    // fresh at arrival, then the page sits with no new response for 70 s
    expect(view(trip(), T0 + 70_000)).toMatchObject({ tone: 'warning', stale: true })
    expect(view(trip(), T0 + 40_000).stale).toBe(false)
  })
  it('uses the server clock, so a viewer phone that is minutes off changes nothing', () => {
    expect(driverAgeSec(trip(), T0, T0)).toBeCloseTo(5, 5)
    expect(driverAgeSec(trip({ driver: null }), T0, T0)).toBeNull()
  })
  it('completed shows the time, cancelled says so; both are muted', () => {
    expect(view(trip({ phase: 'completed', completedAt: new Date(T0 - 60_000).toISOString(), driver: null }))).toMatchObject({ tone: 'muted', text: `Reached destination safely · ${fmt(new Date(T0 - 60_000))}` })
    expect(view(trip({ phase: 'completed', completedAt: null, driver: null })).text).toBe('Reached destination safely')
    expect(view(trip({ phase: 'cancelled', driver: null }))).toMatchObject({ tone: 'muted', text: 'Trip was cancelled' })
  })
  it('speaks the language the viewer chose', () => {
    expect(view(trip({ phase: 'driver_on_way' }), T0, 'hi').text).toBe('पिकअप की ओर · 12 मिनट')
    expect(view(trip({ phase: 'driver_on_way' }), T0, 'or').text).toBe('ପିକଅପ୍ ଆଡ଼କୁ · 12 ମିନିଟ୍')
  })
  it('formats ages in seconds then minutes', () => {
    expect(formatAgo('en', 5)).toBe('5 sec')
    expect(formatAgo('en', 59.4)).toBe('59 sec')
    expect(formatAgo('en', 59.6)).toBe('1 min')
    expect(formatAgo('en', 125)).toBe('2 min')
  })
  it('headline names the rider when known and stays kind when not; the vehicle line skips missing parts', () => {
    expect(headline(trip(), 'en')).toBe('Rahul is on a trip')
    expect(headline(trip({ riderFirstName: null }), 'en')).toBe('A trip has been shared with you')
    // The sentence follows the phase, so it never contradicts the status chip ("is on a trip" under "Trip was cancelled").
    expect(headline(trip({ phase: 'cancelled', driver: null }), 'en')).toBe("Rahul's trip was cancelled")
    expect(headline(trip({ phase: 'completed', driver: null }), 'en')).toBe('Rahul has reached safely')
    expect(headline(trip({ phase: 'finding_driver', driver: null }), 'en')).toBe('Finding a new driver for Rahul')
    expect(headline(trip({ phase: 'driver_on_way' }), 'en')).toBe("Rahul's cab is on the way")
    for (const phase of ['cancelled', 'completed', 'finding_driver', 'driver_on_way'] as const) {
      for (const lang of ['en', 'hi', 'or'] as const) expect(headline(trip({ phase, riderFirstName: null }), lang)).not.toContain('{')
    }
    expect(vehicleLine({ color: 'White', brand: null, model: 'Dzire', plate: null })).toBe('White Dzire')
    expect(mapLabel('en', 2.04)).toContain('2.0 km')
    expect(mapLabel('en', null)).toBe(STRINGS.en['map.label'])
  })
})

describe('polling pace', () => {
  it('5 s normally, 15 s after 10 minutes, 30 s once the trip has ended', () => {
    expect(nextDelayMs({ watchedMs: 0, failures: 0, ended: false })).toBe(POLL_MS)
    expect(nextDelayMs({ watchedMs: SLOW_AFTER_MS, failures: 0, ended: false })).toBe(SLOW_POLL_MS)
    expect(nextDelayMs({ watchedMs: 0, failures: 0, ended: true })).toBe(ENDED_POLL_MS)
  })
  it('backs off on failures (never faster than normal) and caps at a minute', () => {
    const d = (failures: number) => nextDelayMs({ watchedMs: 0, failures, ended: false })
    expect(d(1)).toBe(POLL_MS) // the first retry is at the normal pace: 5 s, 10 s, 20 s ...
    expect(d(2)).toBe(POLL_MS * 2)
    expect(d(3)).toBe(POLL_MS * 4)
    expect(d(20)).toBe(MAX_BACKOFF_MS)
    expect(nextDelayMs({ watchedMs: SLOW_AFTER_MS, failures: 1, ended: false })).toBeGreaterThanOrEqual(SLOW_POLL_MS)
  })
})

describe('glide', () => {
  const a: [number, number] = [20.3, 85.8]
  const near: [number, number] = [20.3005, 85.8]
  const far: [number, number] = [20.31, 85.8]
  const base = { from: a, to: near, sinceLastMs: 5_000, hidden: false, reducedMotion: false }
  it('glides over the time since the last position, within limits', () => {
    expect(planGlide(base)).toEqual({ snap: false, durationMs: 5_000 })
    expect(planGlide({ ...base, sinceLastMs: 100 })).toEqual({ snap: false, durationMs: MIN_GLIDE_MS })
    expect(planGlide({ ...base, sinceLastMs: 60_000 })).toEqual({ snap: false, durationMs: MAX_GLIDE_MS })
  })
  it('snaps on a first position, a jump over 300 m, a hidden tab, or reduced motion', () => {
    expect(planGlide({ ...base, from: null })).toEqual({ snap: true })
    expect(planGlide({ ...base, to: far })).toEqual({ snap: true })
    expect(planGlide({ ...base, hidden: true })).toEqual({ snap: true })
    expect(planGlide({ ...base, reducedMotion: true })).toEqual({ snap: true })
  })
  it('interpolates linearly and clamps', () => {
    expect(lerpPosition([0, 0], [2, 4], 0.5)).toEqual([1, 2])
    expect(lerpPosition([0, 0], [2, 4], 5)).toEqual([2, 4])
    expect(lerpPosition([0, 0], [2, 4], -1)).toEqual([0, 0])
  })
})

describe('fetchPublicTrip', () => {
  const res = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response
  const call = (r: Response | Error) =>
    fetchPublicTrip('abc', { baseUrl: 'https://api.test/', fetchImpl: vi.fn(async () => { if (r instanceof Error) throw r; return r }) as never })
  it('returns the trip on 200', async () => expect(await call(res(200, trip()))).toMatchObject({ kind: 'ok' }))
  it('treats 404 and 410 as a dead link, not a network problem', async () => {
    expect(await call(res(404))).toEqual({ kind: 'inactive' })
    expect(await call(res(410))).toEqual({ kind: 'inactive' })
    expect(await call(res(200, trip({ phase: 'inactive' })))).toEqual({ kind: 'inactive' })
  })
  it('treats 429, 5xx, a thrown fetch and a garbled body as a retryable error', async () => {
    expect(await call(res(429))).toEqual({ kind: 'error' })
    expect(await call(res(503))).toEqual({ kind: 'error' })
    expect(await call(new Error('offline'))).toEqual({ kind: 'error' })
    expect(await call(res(200, { nope: true }))).toEqual({ kind: 'error' })
  })
  it('asks the right URL, with the token encoded, no cookies and no caching', async () => {
    const f = vi.fn(async () => res(200, trip()))
    await fetchPublicTrip('a/b c', { baseUrl: 'https://api.test/', fetchImpl: f as never })
    expect(f).toHaveBeenCalledWith('https://api.test/api/v1/public/trips/a%2Fb%20c', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }))
  })
})

describe('maps error filter', () => {
  it('recognises Google Maps script files and nothing else', () => {
    expect(isMapsScriptError('https://maps.googleapis.com/maps-api-v3/api/js/66/13d/main.js')).toBe(true)
    expect(isMapsScriptError('https://maps.gstatic.com/maps-api-v3/api/js/66/13d/util.js')).toBe(true)
    expect(isMapsScriptError('https://ocarindia.com/_next/static/chunks/app.js')).toBe(false)
    expect(isMapsScriptError('https://evil.example/maps.googleapis.com.js')).toBe(true) // substring match is enough: it only hides, never trusts
    expect(isMapsScriptError(undefined)).toBe(false)
  })

  it('recognises a Maps loader rejection by its stack or message, and nothing else', () => {
    const fromMaps = new Error('Could not load the Maps script')
    fromMaps.stack = 'Error: x at https://maps.googleapis.com/maps/api/js:1:1'
    expect(isMapsRejection(fromMaps)).toBe(true)
    expect(isMapsRejection('Failed to load https://maps.gstatic.com/x.js')).toBe(true)
    expect(isMapsRejection(new Error('our own bug'))).toBe(false)
    expect(isMapsRejection(undefined)).toBe(false)
  })

  it('swallows Maps errors and rejections before other listeners, lets every other one through, and installs only once', () => {
    const listeners: Array<{ type: string; fn: (e: never) => void; capture: boolean }> = []
    const fake = { addEventListener: (type: string, fn: (e: never) => void, capture: boolean) => listeners.push({ type, fn, capture }) } as unknown as Window
    installMapsErrorFilter(fake)
    installMapsErrorFilter(fake)
    expect(listeners.map((l) => l.type)).toEqual(['error', 'unhandledrejection'])
    expect(listeners.every((l) => l.capture)).toBe(true)
    const [onError, onRejection] = [listeners[0]!.fn, listeners[1]!.fn] as Array<(e: unknown) => void>
    const ev = (extra: object) => ({ ...extra, stopImmediatePropagation: vi.fn(), preventDefault: vi.fn() })
    const maps = ev({ filename: 'https://maps.googleapis.com/x.js' })
    onError!(maps)
    expect(maps.stopImmediatePropagation).toHaveBeenCalled()
    const ours = ev({ filename: 'https://ocarindia.com/app.js' })
    onError!(ours)
    expect(ours.stopImmediatePropagation).not.toHaveBeenCalled()
    const mapsRejection = ev({ reason: 'Failed to load https://maps.googleapis.com/maps/api/js' })
    onRejection!(mapsRejection)
    expect(mapsRejection.stopImmediatePropagation).toHaveBeenCalled()
    const oursRejection = ev({ reason: new Error('our own bug') })
    onRejection!(oursRejection)
    expect(oursRejection.stopImmediatePropagation).not.toHaveBeenCalled()
  })
})
