import type { RideRequestPayload } from './types'

// The sentence read aloud when a ride request arrives, so a driver can decide without looking at the phone.
// Pure (no React Native imports) so every wording rule is tested. Addresses stay as written (TTS reads them in the
// selected voice); only the frame sentence is translated.

const MAX_ADDRESS_CHARS = 50 // a spoken address longer than this eats the accept window

export type AnnouncementLang = 'en' | 'hi'

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

export function buildAnnouncement(p: RideRequestPayload, lang: AnnouncementLang = 'en'): string {
  const hi = lang === 'hi'
  const pickup = shortenAddress(p.pickup) || (hi ? 'पिकअप पॉइंट' : 'the pickup point')
  const drop = shortenAddress(p.drop)
  const away = Number.isFinite(p.distanceToPickup) && p.distanceToPickup > 0 ? metresOrKm(p.distanceToPickup, lang) : ''
  const sentences: string[] = [hi ? 'नई राइड रिक्वेस्ट।' : 'New ride request.', `${typeWords(p, lang)}.`]

  sentences.push(hi ? `पिकअप ${pickup}${away ? `, ${away} दूर` : ''}.` : `Pickup ${pickup}${away ? `, ${away} away` : ''}.`)
  if (drop) {
    const length = p.tripKm && p.tripKm > 0 ? `, ${tripKm(p.tripKm, lang)}` : ''
    sentences.push(hi ? `ड्रॉप ${drop}${length}.` : `Drop ${drop}${length}.`)
  }
  if (p.estimatedFare > 0) {
    const fare = Math.round(p.estimatedFare)
    sentences.push(hi ? `किराया ${fare} रुपये।` : `Fare ${fare} rupees.`)
  }
  const pay = payment(p.paymentChannel, lang)
  if (pay) sentences.push(pay)
  return sentences.join(' ').replace(/\.\./g, '.').replace(/\s+/g, ' ').trim()
}
