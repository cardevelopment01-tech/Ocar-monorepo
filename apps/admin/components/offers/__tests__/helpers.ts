import type { OfferDetail, OfferRow, OffersMeta } from '@/lib/offers-api'

// Shared fixtures for the offers screens' tests (not a test file itself).

export const META: OffersMeta = {
  rules: [
    { kind: 'new_user', label: 'New riders only', fields: [] },
    { kind: 'first_n_rides', label: 'First rides', fields: [{ key: 'n', type: 'number', label: 'Number of rides' }] },
    { kind: 'city', label: 'City', fields: [{ key: 'cityIds', type: 'multi', label: 'Cities' }] },
    { kind: 'payment_channel', label: 'Payment method', fields: [{ key: 'channels', type: 'multi', label: 'Payment methods', options: [{ value: 'cash', label: 'Cash' }, { value: 'online', label: 'Online' }] }] },
    { kind: 'min_fare', label: 'Minimum fare', fields: [{ key: 'amount', type: 'number', label: 'Minimum fare (₹)' }] },
  ],
  benefits: [
    { type: 'percent_off', label: 'Percentage off', isCashback: false, fields: [] },
    { type: 'flat_off', label: 'Flat amount off', isCashback: false, fields: [] },
    { type: 'cashback_percent', label: 'Percentage cashback', isCashback: true, fields: [] },
  ],
  capabilities: { cashback: false, cashDiscounts: false, maxDiscountPercent: 15 },
}

export const row = (o: Partial<OfferRow> & { id: string }): OfferRow => ({
  code: 'SAVE10', name: 'Ten off', kind: 'code', status: 'active', version: 1, summary: '10% off', budget_total: '500.00', budget_spent: '410.00',
  global_limit: null, redemption_count: 4, starts_at: null, ends_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...o,
})

export const detail = (o: Partial<OfferDetail> = {}): OfferDetail => ({
  ...row({ id: '5' }),
  versions: [{ id: '9', version: 2, rules: [], benefit: { type: 'percent_off', percent: 10, maxDiscount: 50 }, per_user_limit: null, stacking: 'exclusive', display: {}, created_at: '2026-11-02T00:00:00Z' },
             { id: '8', version: 1, rules: [], benefit: { type: 'percent_off', percent: 5 }, per_user_limit: null, stacking: 'exclusive', display: {}, created_at: '2026-11-01T00:00:00Z' }],
  ...o,
})
