import api from './api'

// Mirrors api/src/modules/offers (admin routes). Money fields arrive as numeric strings from Postgres.

export interface FieldSpec {
  key: string
  type: 'number' | 'text' | 'enum' | 'multi' | 'dateRange' | 'hours'
  label: string
  options?: { value: string; label: string }[]
}
export interface RuleCatalogEntry { kind: string; label: string; fields: FieldSpec[] }
export interface BenefitCatalogEntry { type: BenefitType; label: string; fields: FieldSpec[]; isCashback: boolean }
export interface OffersMeta {
  rules: RuleCatalogEntry[]
  benefits: BenefitCatalogEntry[]
  capabilities: { cashback: boolean; cashDiscounts: boolean; maxDiscountPercent: number }
}

export type BenefitType = 'percent_off' | 'flat_off' | 'cashback_percent' | 'cashback_flat'
export interface Benefit {
  type: BenefitType
  percent?: number
  amount?: number
  maxDiscount?: number
  maxCashback?: number
  expiresInDays?: number
}
/** A stored rule: its kind plus that kind's own config. */
export type Rule = { kind: string } & Record<string, unknown>

export type OfferStatus = 'draft' | 'active' | 'paused' | 'ended'
export type OfferKind = 'code' | 'auto' | 'assigned'

export interface OfferRow {
  id: string
  code: string | null
  name: string
  kind: OfferKind
  status: OfferStatus
  version: number | null
  summary: string | null
  budget_total: string | null
  budget_spent: string
  global_limit: number | null
  redemption_count: number
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}
export interface OfferVersion {
  id: string
  version: number
  rules: Rule[]
  benefit: Benefit
  per_user_limit: number | null
  stacking: string
  display: Record<string, unknown>
  created_at: string
}
export interface OfferDetail extends OfferRow { versions: OfferVersion[] }

export interface OfferStats {
  offerId: string
  redemptions: Record<string, number>
  discountGiven: number
  cashbackGiven: number
  budgetTotal: number | null
  budgetSpent: number
}
export interface Redemption {
  id: string
  user_id: string
  ride_id: string
  status: 'reserved' | 'consumed' | 'released' | 'reversed'
  discount_amount: string
  cashback_amount: string
  reserved_at: string
  consumed_at: string | null
  released_at: string | null
  reason: string | null
}

/** The body of POST /admin/offers and /:id/versions. */
export interface OfferPayload {
  name?: string
  kind?: 'code' | 'auto'
  code?: string | null
  status?: 'draft' | 'active'
  budgetTotal?: number | null
  globalLimit?: number | null
  startsAt?: string | null
  endsAt?: string | null
  rules: Rule[]
  benefit: Benefit
  perUserLimit?: number | null
}

export interface SampleRide {
  fare: { base: number; distance: number; time: number; stop: number; hourSurcharge: number; waiting: number; surge: number; overage: number }
  ride: {
    rideType?: 'one_way' | 'round_trip' | 'rental'; categoryId?: number; cityId?: number | null
    originCityId?: number | null; destinationCityId?: number | null; paymentChannel?: 'cash' | 'online' | 'wallet'
  }
  completedRides?: number
}
export interface DraftPreview {
  summary: string
  /** Present only when a sample ride was sent. */
  eligible?: boolean
  reason?: string | null
  message?: string | null
  discount?: number
  cashback?: number
}

export const offersApi = {
  meta: () => api.get('/api/v1/admin/offers/meta').then(r => r.data as OffersMeta),
  list: (params: { status?: string; search?: string; limit?: number; offset?: number }) =>
    api.get('/api/v1/admin/offers', { params }).then(r => r.data as { offers: OfferRow[]; counts: Record<string, number> }),
  get: (id: string) => api.get(`/api/v1/admin/offers/${id}`).then(r => r.data.offer as OfferDetail),
  create: (body: OfferPayload) => api.post('/api/v1/admin/offers', body).then(r => r.data.offer as OfferDetail),
  patch: (id: string, body: Partial<{ name: string; status: OfferStatus; endsAt: string | null; budgetTotal: number | null; globalLimit: number | null }>) =>
    api.patch(`/api/v1/admin/offers/${id}`, body).then(r => r.data.offer as OfferDetail),
  createVersion: (id: string, body: Pick<OfferPayload, 'rules' | 'benefit' | 'perUserLimit'>) =>
    api.post(`/api/v1/admin/offers/${id}/versions`, body).then(r => r.data.offer as OfferDetail),
  previewDraft: (body: { rules: Rule[]; benefit: Benefit; sample?: SampleRide }) =>
    api.post('/api/v1/admin/offers/preview-draft', body).then(r => r.data as DraftPreview),
  stats: (id: string) => api.get(`/api/v1/admin/offers/${id}/stats`).then(r => r.data as OfferStats),
  redemptions: (id: string, params: { status?: string; from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get(`/api/v1/admin/offers/${id}/redemptions`, { params }).then(r => r.data.redemptions as Redemption[]),
}
