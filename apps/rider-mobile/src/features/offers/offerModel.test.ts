import { describe, it, expect } from 'vitest'
import {
  autoOfferParam, bookAmount, bookingOfferFields, buildFareLines, couponLineState, formatRupees, parseOfferNotApplicable, parsePriceChanged,
  priceChangedMessage, savingsLabel, type AppliedOffer, type OfferPreview,
} from './offerModel'

// Value: protects=what the rider is shown and what the booking sends stay in step: the price on Book is the payable, a
// stale or rejected code never rides along, a changed price reads as old -> new with the reason, and the server's words
// are used verbatim; fails_when=any of those drift; why_new=PR4 rider logic; seam=none; no_claim=rendering and the API.

const offer = (o: Partial<AppliedOffer> = {}): AppliedOffer => ({
  offerId: '5', versionId: '9', code: 'SAVE50', name: 'Save 50', kind: 'code', summary: '10% off', discount: 91, cashback: 0, ...o,
})
const preview = (o: Partial<OfferPreview> = {}): OfferPreview => ({
  enabled: true, fareTotal: 454, discount: 91, cashback: 0, payable: 363, applied: offer(), alternatives: [], rejected: [], ineligible: [], ...o,
})

describe('couponLineState', () => {
  it('offers off: the row does not exist (the screen looks exactly as before)', () => {
    expect(couponLineState({ status: 'ready', preview: preview({ enabled: false, applied: null, discount: 0, payable: 454 }), typedCode: '', fullPrice: 454 })).toEqual({ kind: 'off' })
    expect(couponLineState({ status: 'idle', preview: null, typedCode: '', fullPrice: 454 })).toEqual({ kind: 'off' })
  })
  it('loading and error are their own states, and error carries the full price so booking is never blocked', () => {
    expect(couponLineState({ status: 'loading', preview: preview(), typedCode: '', fullPrice: 454 })).toEqual({ kind: 'loading' })
    expect(couponLineState({ status: 'error', preview: null, typedCode: 'X', fullPrice: 454 })).toEqual({ kind: 'error', fullPrice: 454 })
  })
  it('a typed code that applied is "applied"; an automatic offer is marked auto', () => {
    expect(couponLineState({ status: 'ready', preview: preview(), typedCode: 'SAVE50', fullPrice: 454 })).toMatchObject({ kind: 'applied', auto: false })
    expect(couponLineState({ status: 'ready', preview: preview({ applied: offer({ kind: 'auto', code: null }) }), typedCode: '', fullPrice: 454 })).toMatchObject({ kind: 'applied', auto: true })
  })
  it('a rejected typed code is explained even when an automatic offer applied instead', () => {
    const p = preview({ applied: offer({ kind: 'auto', code: null }), rejected: [{ code: 'WRONG1', reason: 'UNKNOWN_CODE', message: "That code isn't valid" }] })
    expect(couponLineState({ status: 'ready', preview: p, typedCode: 'WRONG1', fullPrice: 454 })).toMatchObject({ kind: 'rejected', message: "That code isn't valid" })
  })
  it('a rejected typed code shows the server message and keeps the code; no code and no offer is idle', () => {
    const p = preview({ applied: null, discount: 0, payable: 454, rejected: [{ code: 'NOPE', reason: 'UNKNOWN_CODE', message: "That code isn't valid" }] })
    expect(couponLineState({ status: 'ready', preview: p, typedCode: 'NOPE', fullPrice: 454 })).toEqual({ kind: 'rejected', message: "That code isn't valid", code: 'NOPE' })
    expect(couponLineState({ status: 'ready', preview: { ...p, rejected: [] }, typedCode: '', fullPrice: 454 })).toEqual({ kind: 'idle' })
  })
})

describe('fare lines and the Book amount', () => {
  it('orders gross, the offer taken off, then what the rider pays, and omits the offer line at zero', () => {
    expect(buildFareLines(preview())).toEqual([
      { key: 'fare', label: 'Fare', amount: 454 }, { key: 'offer', label: 'Offer SAVE50', amount: 91, negative: true }, { key: 'paid', label: 'You pay', amount: 363 },
    ])
    expect(buildFareLines(preview({ applied: null, discount: 0, payable: 454 })).map((l) => l.key)).toEqual(['fare', 'paid'])
  })
  it('Book shows the payable when an offer applies, else the plain fare, and nothing without a fare', () => {
    expect(bookAmount(454, preview())).toBe(363)
    expect(bookAmount(454, preview({ enabled: false }))).toBe(454)
    expect(bookAmount(454, preview({ applied: null }))).toBe(454)
    expect(bookAmount(454, null)).toBe(454)
    expect(bookAmount(null, preview())).toBeNull()
  })
  it('the struck-through price has a spoken meaning', () => {
    expect(savingsLabel(454, 363)).toBe('was ₹454, now ₹363')
    expect(formatRupees(1234.5)).toBe('₹1,235')
  })
})

describe('bookingOfferFields', () => {
  it('adds nothing when offers are off, so the request is exactly the old one', () => {
    expect(bookingOfferFields({ preview: preview({ enabled: false }), typedCode: 'SAVE50', choice: { kind: 'best' } })).toEqual({})
    expect(bookingOfferFields({ preview: null, typedCode: '', choice: { kind: 'best' } })).toEqual({})
  })
  it('sends the payable the rider saw, plus the code only when it applied', () => {
    expect(bookingOfferFields({ preview: preview(), typedCode: 'save50', choice: { kind: 'best' } })).toEqual({ expectedPayable: 363, couponCode: 'save50' })
    const rejected = preview({ applied: null, discount: 0, payable: 454, rejected: [{ code: 'NOPE', reason: 'UNKNOWN_CODE', message: 'x' }] })
    expect(bookingOfferFields({ preview: rejected, typedCode: 'NOPE', choice: { kind: 'best' } })).toEqual({ expectedPayable: 454 })
  })
  it('carries the rider\'s choice about automatic offers', () => {
    const auto = preview({ applied: offer({ kind: 'auto', code: null }) })
    expect(bookingOfferFields({ preview: auto, typedCode: '', choice: { kind: 'none' } })).toMatchObject({ autoOffer: 'none' })
    expect(bookingOfferFields({ preview: auto, typedCode: '', choice: { kind: 'offer', offerId: '7' } })).toMatchObject({ autoOffer: '7' })
    expect(bookingOfferFields({ preview: auto, typedCode: '', choice: { kind: 'best' } })).not.toHaveProperty('autoOffer')
    expect(autoOfferParam({ kind: 'best' })).toBeUndefined()
  })
})

describe('409 PRICE_CHANGED and 422 OFFER_NOT_APPLICABLE', () => {
  const err409 = (details: unknown) => ({ response: { status: 409, data: { code: 'PRICE_CHANGED', details } } })
  it('parses the details and rejects other errors', () => {
    expect(parsePriceChanged(err409({ fareTotal: 454, discount: 0, payable: 454, appliedOffer: null, reason: 'OFFER_UNAVAILABLE' }))).toMatchObject({ payable: 454, reason: 'OFFER_UNAVAILABLE' })
    expect(parsePriceChanged(err409({ nope: true }))).toBeNull()
    expect(parsePriceChanged({ response: { status: 409, data: { code: 'RIDE_ALREADY_ACTIVE' } } })).toBeNull()
    expect(parsePriceChanged(new Error('x'))).toBeNull()
  })
  it('says old to new and why, and never claims an offer is gone when only the fare moved', () => {
    const gone = { fareTotal: 454, discount: 0, payable: 454, appliedOffer: null, reason: 'OFFER_UNAVAILABLE' }
    expect(priceChangedMessage(gone, 363, 'SAVE50')).toBe('Price updated: ₹363 → ₹454. Offer SAVE50 is no longer available.')
    expect(priceChangedMessage(gone, null, null)).toBe('Price updated: ₹454. Offer is no longer available.')
    expect(priceChangedMessage({ ...gone, reason: 'FARE_CHANGED' }, 363, 'SAVE50')).toBe('Price updated: ₹363 → ₹454.')
  })
  it('parses the not-applicable 422 with the server message', () => {
    expect(parseOfferNotApplicable({ response: { status: 422, data: { code: 'OFFER_NOT_APPLICABLE', error: 'Add ₹46 more to use this offer', details: { reason: 'MIN_FARE' } } } }))
      .toEqual({ message: 'Add ₹46 more to use this offer', reason: 'MIN_FARE' })
    expect(parseOfferNotApplicable({ response: { status: 422, data: { code: 'VALIDATION_ERROR' } } })).toBeNull()
  })
})
