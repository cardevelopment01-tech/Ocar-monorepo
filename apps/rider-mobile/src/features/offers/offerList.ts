import type { OfferListItem } from './api'

/** "Ends 12 Dec" in plain text (no countdown, no urgency), India time; null when the offer has no end. */
export function expiryText(endsAt: string | null, now: Date = new Date()): string | null {
  if (!endsAt) return null
  const d = new Date(endsAt)
  if (Number.isNaN(d.getTime())) return null
  if (d.getTime() <= now.getTime()) return 'Ended'
  return `Ends ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}`
}

/**
 * The single calm card for the home screen (design review D5): the first listed offer, or nothing at all when there is
 * none. Never a carousel and never a made-up placeholder.
 */
export function homeOffer(offers: OfferListItem[]): OfferListItem | null {
  return offers[0] ?? null
}
