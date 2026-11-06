import { t, type Lang, type StringKey } from './i18n'
import type { PublicTrip } from './types'

// What the status pill and the freshness line say. Pure, so the wording rules are tested without a browser.
// "Last seen" and "Updated N sec ago" are worked out from the SERVER's clock (serverTime vs the driver's updatedAt) plus the time
// since the response arrived, never from the viewer's own clock, which can be minutes off.

export const STALE_AFTER_SEC = 60

export type PillTone = 'info' | 'success' | 'warning' | 'muted'

export interface StatusView {
  tone: PillTone
  text: string
  /** "Updated 5 sec ago" while live, "Last seen 2 min ago" when stale, null when there is no driver position to talk about. */
  freshness: string | null
  stale: boolean
  /** The one line a relative came for: "Arriving 12:10 am" / "Reaches pickup in 6 min". Null when there is no trustworthy ETA. */
  eta: string | null
}

export function driverAgeSec(trip: PublicTrip, receivedAtMs: number, nowMs: number): number | null {
  if (!trip.driver) return null
  const atServer = (Date.parse(trip.serverTime) - Date.parse(trip.driver.updatedAt)) / 1000
  return Math.max(0, atServer + (nowMs - receivedAtMs) / 1000)
}

export function formatAgo(lang: Lang, seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return s < 60 ? t(lang, 'time.sec', { n: s }) : t(lang, 'time.min', { n: Math.floor(s / 60) })
}

export function statusView(input: {
  trip: PublicTrip
  lang: Lang
  receivedAtMs: number
  nowMs: number
  /** Formats a clock time in the viewer's language, e.g. "4:35 pm". */
  formatTime: (d: Date) => string
}): StatusView {
  const { trip, lang } = input
  if (trip.phase === 'cancelled') return { tone: 'muted', text: t(lang, 'status.cancelled'), freshness: null, stale: false, eta: null }
  // The driver cancelled and dispatch is looking again: the link is alive and comes back to a live trip when someone accepts.
  if (trip.phase === 'finding_driver') return { tone: 'info', text: t(lang, 'status.finding'), freshness: null, stale: false, eta: null }
  if (trip.phase === 'completed') {
    const text = trip.completedAt ? t(lang, 'status.completedAt', { time: input.formatTime(new Date(trip.completedAt)) }) : t(lang, 'status.completed')
    return { tone: 'muted', text, freshness: null, stale: false, eta: null }
  }

  const onWay = trip.phase === 'driver_on_way'
  const age = driverAgeSec(trip, input.receivedAtMs, input.nowMs)
  const stale = age !== null && age > STALE_AFTER_SEC
  const base = onWay ? t(lang, 'status.onWay') : t(lang, 'status.inTrip')

  if (stale) return { tone: 'warning', text: base, freshness: t(lang, 'status.stale', { ago: formatAgo(lang, age) }), stale: true, eta: null }

  let text = base
  if (trip.etaMin != null) {
    text = onWay
      ? t(lang, 'status.onWayEta', { min: trip.etaMin })
      // Arrival is anchored to the moment the server worked the ETA out (serverTime), never to the ticking clock: anchoring it to "now" made
      // the arrival time creep later every second until the next response.
      : t(lang, 'status.inTripEta', { time: input.formatTime(new Date(Date.parse(trip.serverTime) + trip.etaMin * 60_000)) })
  }
  let eta: string | null = null
  if (trip.etaMin != null) {
    eta = onWay
      ? t(lang, 'eta.onWay', { min: trip.etaMin })
      : t(lang, 'eta.inTrip', { time: input.formatTime(new Date(Date.parse(trip.serverTime) + trip.etaMin * 60_000)) })
  }
  return { tone: onWay ? 'info' : 'success', text, freshness: age === null ? null : t(lang, 'status.updated', { ago: formatAgo(lang, age) }), stale: false, eta }
}

export function headline(trip: PublicTrip, lang: Lang): string {
  // The sentence follows the phase, so it never contradicts the status chip above it ("is on a trip" under "Trip was cancelled").
  const key = trip.phase === 'completed' ? 'headline.completed'
    : trip.phase === 'cancelled' ? 'headline.cancelled'
    : trip.phase === 'finding_driver' ? 'headline.finding'
    : trip.phase === 'driver_on_way' ? 'headline.onWay'
    : 'headline.named'
  if (!trip.riderFirstName) return t(lang, key === 'headline.named' ? 'headline.anon' : (`${key}Anon` as StringKey))
  return t(lang, key, { name: trip.riderFirstName })
}

export function vehicleLine(v: PublicTrip['vehicle']): string {
  return [v.color, v.brand, v.model].filter((x): x is string => Boolean(x)).join(' ')
}

/** The text a screen reader gets for the map: where the car is relative to where it is going. */
export function mapLabel(lang: Lang, distanceKm: number | null): string {
  const base = t(lang, 'map.label')
  return distanceKm == null ? base : `${base}. ${distanceKm.toFixed(1)} km`
}
