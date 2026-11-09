// Copy of apps/rider-mobile/src/features/offers/offerModel.ts (pure, no imports). Keep the two in step.
// Pure logic behind the rider's offer UI (fare screen, offer sheet, trip summary), kept out of the components so it can be
// tested. All wording about WHY an offer did or did not apply comes from the server (`summary`, `message`); the only copy
// written here is the frame around it (the coupon line labels, the price-changed sentence, the error fallback).

export type AppliedOffer = {
  offerId: string
  versionId: string
  code: string | null
  name: string
  kind: 'code' | 'auto' | 'assigned'
  summary: string
  discount: number
  cashback: number
}

export type Rejection = { offerId?: string; code?: string; reason: string; message: string }
export type IneligibleOffer = { offerId: string; name: string; summary: string; message: string }

export type OfferPreview = {
  enabled: boolean
  fareTotal: number
  discount: number
  cashback: number
  payable: number
  applied: AppliedOffer | null
  alternatives: AppliedOffer[]
  rejected: Rejection[]
  ineligible: IneligibleOffer[]
}

export type PriceChangedDetails = {
  fareTotal: number
  discount: number
  payable: number
  appliedOffer: AppliedOffer | null
  reason: 'FARE_CHANGED' | 'OFFER_UNAVAILABLE' | string
}

export const LOADING_BOOK_LOCK_MS = 1000

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
export const formatRupees = rupees

// ── Where the coupon line stands ─────────────────────────────────────────────

export type CouponLineState =
  | { kind: 'off' }                                              // offers are not on: the row does not exist
  | { kind: 'idle' }                                             // "Have a code?"
  | { kind: 'loading' }                                          // skeleton on the price
  | { kind: 'applied'; offer: AppliedOffer; auto: boolean }       // "SAVE50 applied" / "Best offer applied"
  | { kind: 'rejected'; message: string; code: string | null }    // the server's reason, input kept
  | { kind: 'error'; fullPrice: number }                         // "Couldn't check the offer. You can still book at ₹454"

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error'

export function couponLineState(args: {
  status: PreviewStatus
  preview: OfferPreview | null
  typedCode: string
  fullPrice: number | null
}): CouponLineState {
  const { status, preview, typedCode, fullPrice } = args
  if (status === 'loading') return { kind: 'loading' }
  if (status === 'error') return { kind: 'error', fullPrice: fullPrice ?? preview?.fareTotal ?? 0 }
  if (!preview || !preview.enabled) return { kind: 'off' }
  // A typed code that did not apply must say so, even when an automatic offer applied in its place.
  if (typedCode !== '' && preview.applied?.code?.toUpperCase() !== typedCode.toUpperCase()) {
    const mine = preview.rejected.find((r) => r.code === undefined || r.code.toUpperCase() === typedCode.toUpperCase()) ?? preview.rejected[0]
    if (mine) return { kind: 'rejected', message: mine.message, code: typedCode }
  }
  if (preview.applied) return { kind: 'applied', offer: preview.applied, auto: preview.applied.kind === 'auto' && typedCode === '' }
  if (typedCode !== '') {
    const mine = preview.rejected.find((r) => r.code === undefined || r.code.toUpperCase() === typedCode.toUpperCase()) ?? preview.rejected[0]
    if (mine) return { kind: 'rejected', message: mine.message, code: typedCode }
  }
  return { kind: 'idle' }
}

// ── The fare lines (booking summary / receipt) ───────────────────────────────

export type FareLine = { key: 'fare' | 'offer' | 'paid'; label: string; amount: number; negative?: boolean }

/** Gross, the offer taken off, then what the rider pays. The offer line is left out when there is no discount. */
export function buildFareLines(p: Pick<OfferPreview, 'fareTotal' | 'discount' | 'payable' | 'applied'>): FareLine[] {
  const lines: FareLine[] = [{ key: 'fare', label: 'Fare', amount: p.fareTotal }]
  if (p.discount > 0) lines.push({ key: 'offer', label: `Offer ${p.applied?.code ?? p.applied?.name ?? ''}`.trim(), amount: p.discount, negative: true })
  lines.push({ key: 'paid', label: 'You pay', amount: p.payable })
  return lines
}

/** The amount on the Book button: the payable when an offer applies, else the plain fare. */
export function bookAmount(fare: number | null, preview: OfferPreview | null): number | null {
  if (fare == null) return null
  return preview?.enabled && preview.applied ? preview.payable : fare
}

/** Spoken form of a struck-through price, so a screen reader hears the meaning, not "454 363". */
export function savingsLabel(gross: number, payable: number): string {
  return `was ${rupees(gross)}, now ${rupees(payable)}`
}

// ── 409 PRICE_CHANGED ───────────────────────────────────────────────────────

export function priceChangedMessage(d: PriceChangedDetails, previous: number | null, code: string | null): string {
  const nowPay = rupees(d.payable)
  const was = previous != null ? `${rupees(previous)} → ` : ''
  if (d.reason === 'OFFER_UNAVAILABLE') {
    return `Price updated: ${was}${nowPay}. Offer${code ? ` ${code}` : ''} is no longer available.`
  }
  return `Price updated: ${was}${nowPay}.`
}

/** Parses the 409 body the API sends; null when the error is some other failure. */
export function parsePriceChanged(err: unknown): PriceChangedDetails | null {
  const e = err as { response?: { status?: number; data?: { code?: string; details?: Partial<PriceChangedDetails> } } }
  if (e?.response?.status !== 409 || e.response.data?.code !== 'PRICE_CHANGED') return null
  const d = e.response.data.details
  if (!d || typeof d.payable !== 'number' || typeof d.fareTotal !== 'number') return null
  return { fareTotal: d.fareTotal, discount: d.discount ?? 0, payable: d.payable, appliedOffer: d.appliedOffer ?? null, reason: d.reason ?? 'FARE_CHANGED' }
}

/** The OFFER_NOT_APPLICABLE 422 at booking: the server's message and reason, or null for another failure. */
export function parseOfferNotApplicable(err: unknown): { message: string; reason: string } | null {
  const e = err as { response?: { status?: number; data?: { code?: string; error?: string; details?: { reason?: string } } } }
  if (e?.response?.status !== 422 || e.response.data?.code !== 'OFFER_NOT_APPLICABLE') return null
  return { message: e.response.data.error ?? "This offer isn't available right now", reason: e.response.data.details?.reason ?? 'DISABLED' }
}

// ── The booking request ─────────────────────────────────────────────────────

export type OfferChoice =
  | { kind: 'best' }                                  // let the server pick the best automatic offer
  | { kind: 'none' }                                  // the rider removed the automatic offer
  | { kind: 'offer'; offerId: string }                // the rider picked one in the offer sheet

export function autoOfferParam(choice: OfferChoice): string | undefined {
  return choice.kind === 'none' ? 'none' : choice.kind === 'offer' ? choice.offerId : undefined
}

/**
 * What to add to a booking request. expectedPayable goes only when offers are on (an app that saw no offers system books
 * exactly as before); the code only when one is typed AND still applied (a rejected code is not sent, so a stale code
 * cannot fail a booking the rider already saw at full price).
 */
export function bookingOfferFields(args: {
  preview: OfferPreview | null
  typedCode: string
  choice: OfferChoice
}): { couponCode?: string; expectedPayable?: number; autoOffer?: string } {
  const { preview, typedCode, choice } = args
  const out: { couponCode?: string; expectedPayable?: number; autoOffer?: string } = {}
  if (!preview || !preview.enabled) return out
  out.expectedPayable = preview.payable
  if (typedCode !== '' && preview.applied?.code && preview.applied.code.toUpperCase() === typedCode.toUpperCase()) out.couponCode = typedCode
  const auto = autoOfferParam(choice)
  if (auto !== undefined) out.autoOffer = auto
  return out
}

/** Cash rider told cash discounts are off: the one preview reason the app cannot fix by itself (payment is fixed to cash). */
export function isPaymentMethodRejection(r: Rejection | undefined): boolean {
  return r?.reason === 'PAYMENT_CHANNEL'
}
