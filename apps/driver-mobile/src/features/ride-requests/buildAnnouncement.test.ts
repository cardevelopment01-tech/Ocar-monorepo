import { describe, expect, it } from 'vitest'
import { buildAnnouncement, shortenAddress } from './buildAnnouncement'
import type { RideRequestPayload } from './types'

// Value: protects=drivers hear the right ride type, places, distance and fare, short enough to finish inside the accept
// window, with no house numbers/PIN codes read out; fails_when=a field is dropped, mispronounced as a raw number, or a
// round trip is announced as one way; why_new=voice announcement; seam=pure function, no TTS engine; no_claim=voice quality.
const base: RideRequestPayload = {
  rideId: '1', pickup: 'Saheed Nagar, Bhubaneswar, Odisha 751007, India', drop: 'Badambadi, Cuttack, Odisha',
  pickupLat: 20.3, pickupLng: 85.8, distanceToPickup: 1240, estimatedFare: 449.6, rideType: 'one_way', isReturnCab: false,
  expiresAt: '', timeoutSeconds: 20, paymentChannel: 'cash', tripKm: 28.4, rideCategoryName: 'Sedan',
}

describe('shortenAddress', () => {
  it('keeps the locality, drops PIN, state-with-PIN and country', () => {
    expect(shortenAddress('Saheed Nagar, Bhubaneswar, Odisha 751007, India')).toBe('Saheed Nagar, Bhubaneswar')
  })
  it('drops house/plot numbers and unnamed roads', () => {
    expect(shortenAddress('Plot 12, Unnamed Road, Patia, Bhubaneswar')).toBe('Patia, Bhubaneswar')
    expect(shortenAddress('12/B, Station Road, Puri')).toBe('Station Road, Puri')
  })
  it('returns empty when nothing speakable is left, and trims very long parts', () => {
    expect(shortenAddress('751007, India')).toBe('')
    expect(shortenAddress('A'.repeat(80)).length).toBeLessThanOrEqual(50)
    expect(shortenAddress('Very Long Locality Name Nagar, Another Quite Long City Name, Odisha').length).toBeLessThanOrEqual(50)
  })
})

describe('buildAnnouncement (English)', () => {
  it('reads type, category, pickup with distance, drop with length, fare and payment', () => {
    expect(buildAnnouncement(base)).toBe(
      'New ride request. One way, Sedan. Pickup Saheed Nagar, Bhubaneswar, 1.2 kilometres away. Drop Badambadi, Cuttack, 28 kilometres. Fare 450 rupees. Cash.'
    )
  })
  it('metres under a kilometre, singular kilometre, trip length with one decimal under 10 km', () => {
    expect(buildAnnouncement({ ...base, distanceToPickup: 480, tripKm: 7.26 })).toContain('480 metres away')
    expect(buildAnnouncement({ ...base, distanceToPickup: 1000 })).toContain('1 kilometre away')
    expect(buildAnnouncement({ ...base, tripKm: 7.26 })).toContain('7.3 kilometres')
  })
  it('round trip with hours and stops, return cab, rental', () => {
    expect(buildAnnouncement({ ...base, rideType: 'round_trip', tripHours: 8, stopCount: 2 })).toContain('Round trip, Sedan, 8 hours, 2 stops.')
    expect(buildAnnouncement({ ...base, isReturnCab: true })).toContain('Return cab, Sedan.')
    expect(buildAnnouncement({ ...base, rideType: 'rental', tripHours: 4 })).toContain('Rental, Sedan, 4 hours.')
  })
  it('skips what it does not know instead of saying "undefined" or "zero"', () => {
    const { rideCategoryName: _c, tripKm: _t, paymentChannel: _p, ...bare } = base
    const text = buildAnnouncement({ ...bare, estimatedFare: 0, distanceToPickup: 0 })
    expect(text).toBe('New ride request. One way. Pickup Saheed Nagar, Bhubaneswar. Drop Badambadi, Cuttack.')
    expect(text).not.toMatch(/undefined|NaN|zero|0 rupees/)
  })
  it('falls back when an address has nothing speakable, and never reads a phone number or name', () => {
    expect(buildAnnouncement({ ...base, pickup: '751007' })).toContain('Pickup the pickup point')
    expect(buildAnnouncement(base)).not.toMatch(/\d{6,}/)
  })
  it('online and wallet payments', () => {
    expect(buildAnnouncement({ ...base, paymentChannel: 'online' })).toMatch(/Paid online\.$/)
    expect(buildAnnouncement({ ...base, paymentChannel: 'wallet' })).toMatch(/Wallet\.$/)
  })
  it('is short enough to finish inside the accept window (a worst-case request under about 250 characters)', () => {
    const long = buildAnnouncement({ ...base, pickup: 'B'.repeat(60) + ', ' + 'C'.repeat(60), drop: 'D'.repeat(60) + ', ' + 'E'.repeat(60), stopCount: 3, tripHours: 12, rideType: 'round_trip' })
    expect(long.length).toBeLessThan(260)
  })
})

describe('buildAnnouncement (Hindi)', () => {
  it('translates the frame, keeps the place names', () => {
    expect(buildAnnouncement(base, 'hi')).toBe(
      'नई राइड रिक्वेस्ट। वन वे, Sedan. पिकअप Saheed Nagar, Bhubaneswar, 1.2 किलोमीटर दूर. ड्रॉप Badambadi, Cuttack, 28 किलोमीटर. किराया 450 रुपये। कैश।'
    )
  })
})
