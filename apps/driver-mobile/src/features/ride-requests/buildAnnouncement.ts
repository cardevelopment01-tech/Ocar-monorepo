import type { RideRequestPayload } from './types'

// The sentence read aloud when a ride request arrives, so a driver can decide without looking at the phone.
// Pure (no React Native imports) so every wording rule is tested. Addresses stay as written (TTS reads them in the
// selected voice); only the frame sentence is translated.

const MAX_ADDRESS_CHARS = 50 // a spoken address longer than this eats the accept window

export type AnnouncementLang = 'en' | 'hi'

/** The language tag handed to the system voice. Falls back to the phone's default voice when the language is not installed. */
export const SPEECH_LOCALE = { en: 'en-IN', hi: 'hi-IN' } as const

/** Locality-level part of an address: drops house/plot numbers, PIN codes, "Unnamed Road", country; at most two parts. */
export function shortenAddress(address: string): string {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p) => !/^\d/.test(p)) // "751007", "12/B"
    .filter((p) => !/^(plot|house|flat|door|h\.?\s?no|no\.?|#)\s*[\w/-]*\d/i.test(p)) // "Plot 12", "H.No 4-5"
    .filter((p) => !/unnamed road/i.test(p))
    .filter((p) => !/\b\d{6}\b/.test(p)) // "Odisha 751007"
    .filter((p) => !/^(india|odisha|orissa)$/i.test(p))
  const joined = parts.slice(0, 2).join(', ')
  if (joined.length <= MAX_ADDRESS_CHARS) return joined
  const cut = joined.slice(0, MAX_ADDRESS_CHARS)
  return (cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[,\s]+$/, '')
}

function metresOrKm(metres: number, lang: AnnouncementLang): string {
  if (metres < 1000) {
    const m = Math.max(10, Math.round(metres / 10) * 10)
    return lang === 'hi' ? `${m} मीटर` : `${m} metres`
  }
  const km = Math.round(metres / 100) / 10
  return lang === 'hi' ? `${km} किलोमीटर` : `${km} ${km === 1 ? 'kilometre' : 'kilometres'}`
}

function tripKm(km: number, lang: AnnouncementLang): string {
  const v = km < 10 ? Math.round(km * 10) / 10 : Math.round(km)
  return lang === 'hi' ? `${v} किलोमीटर` : `${v} ${v === 1 ? 'kilometre' : 'kilometres'}`
}

function typeWords(p: RideRequestPayload, lang: AnnouncementLang): string {
  const hi = lang === 'hi'
  const kind = p.isReturnCab
    ? hi ? 'रिटर्न कैब' : 'Return cab'
    : p.rideType === 'round_trip'
      ? hi ? 'राउंड ट्रिप' : 'Round trip'
      : p.rideType === 'rental'
        ? hi ? 'रेंटल' : 'Rental'
        : hi ? 'वन वे' : 'One way'
  const category = p.rideCategoryName ? `, ${p.rideCategoryName}` : ''
  const hours = (p.rideType === 'round_trip' || p.rideType === 'rental') && p.tripHours ? (hi ? `, ${p.tripHours} घंटे` : `, ${p.tripHours} hours`) : ''
  const stops = p.stopCount && p.stopCount > 0 ? (hi ? `, ${p.stopCount} स्टॉप` : `, ${p.stopCount} ${p.stopCount === 1 ? 'stop' : 'stops'}`) : ''
  return `${kind}${category}${hours}${stops}`
}

function payment(channel: string | undefined, lang: AnnouncementLang): string {
  const hi = lang === 'hi'
  if (channel === 'cash') return hi ? 'कैश।' : 'Cash.'
  if (channel === 'online') return hi ? 'ऑनलाइन पेमेंट।' : 'Paid online.'
  if (channel === 'wallet') return hi ? 'वॉलेट।' : 'Wallet.'
  return ''
}

/** Which part of the pop-up a stretch of the spoken sentence belongs to. */
export type SegmentKey = 'intro' | 'type' | 'pickup' | 'drop' | 'fare'
export type Segment = { key: SegmentKey; text: string }

/** The announcement as ordered parts, one per region of the pop-up. Joined with single spaces they are the spoken text. */
export function buildAnnouncementSegments(p: RideRequestPayload, lang: AnnouncementLang = 'en'): Segment[] {
  const hi = lang === 'hi'
  const pickup = shortenAddress(p.pickup) || (hi ? 'पिकअप पॉइंट' : 'the pickup point')
  const drop = shortenAddress(p.drop)
  const away = Number.isFinite(p.distanceToPickup) && p.distanceToPickup > 0 ? metresOrKm(p.distanceToPickup, lang) : ''
  const segments: Segment[] = [
    { key: 'intro', text: hi ? 'नई राइड रिक्वेस्ट।' : 'New ride request.' },
    { key: 'type', text: `${typeWords(p, lang)}.` },
    { key: 'pickup', text: hi ? `पिकअप ${pickup}${away ? `, ${away} दूर` : ''}.` : `Pickup ${pickup}${away ? `, ${away} away` : ''}.` },
  ]
  if (drop) {
    const length = p.tripKm && p.tripKm > 0 ? `, ${tripKm(p.tripKm, lang)}` : ''
    segments.push({ key: 'drop', text: hi ? `ड्रॉप ${drop}${length}.` : `Drop ${drop}${length}.` })
  }
  const fare = p.estimatedFare > 0 ? (hi ? `किराया ${Math.round(p.estimatedFare)} रुपये।` : `Fare ${Math.round(p.estimatedFare)} rupees.`) : ''
  const pay = payment(p.paymentChannel, lang)
  const fareText = [fare, pay].filter(Boolean).join(' ')
  if (fareText) segments.push({ key: 'fare', text: fareText })
  return segments
}

export function buildAnnouncement(p: RideRequestPayload, lang: AnnouncementLang = 'en'): string {
  return buildAnnouncementSegments(p, lang).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim()
}

/** Start offset of each segment inside the joined sentence. */
function offsets(segments: Segment[]): number[] {
  const out: number[] = []
  let at = 0
  for (const s of segments) {
    out.push(at)
    at += s.text.length + 1 // the joining space
  }
  return out
}

/** The segment the character at `charIndex` of the joined sentence belongs to; null outside it. */
export function segmentAt(segments: Segment[], charIndex: number): SegmentKey | null {
  if (segments.length === 0 || charIndex < 0) return null
  const starts = offsets(segments)
  const total = starts[starts.length - 1]! + segments[segments.length - 1]!.text.length
  if (charIndex >= total) return null
  let found = 0
  for (let i = 0; i < starts.length; i++) if (charIndex >= starts[i]!) found = i
  return segments[found]!.key
}

/** When the speech engine reports no word positions: the segment expected at `elapsedMs`, assuming an even pace over `totalMs`. */
export function segmentAtTime(segments: Segment[], elapsedMs: number, totalMs: number): SegmentKey | null {
  if (segments.length === 0 || totalMs <= 0 || elapsedMs < 0 || elapsedMs >= totalMs) return null
  const length = segments.reduce((n, s) => n + s.text.length + 1, 0) - 1
  return segmentAt(segments, Math.floor((elapsedMs / totalMs) * length))
}

/** A generous estimate of how long the sentence takes to say, in ms (same shape as the ring-resume safety timer). */
export function estimateSpeechMs(text: string, rate = 0.95): number {
  return (Math.min(9_000, 2_500 + text.length * 70) / Math.max(0.5, rate)) * 0.9
}
