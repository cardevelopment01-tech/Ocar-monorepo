import { Counter, Gauge } from 'prom-client'
import { register } from './metrics'

// Offers observability (offers plan Task 12). Every label here is a small fixed set (statuses, reason codes) except the
// budget gauge's offer id, which is bounded by the number of live offers (tens) and is reset on every refresh.

export const offersRedemptionsTotal = new Counter({
  name: 'offers_redemptions_total',
  help: 'Offer redemption state changes (reserved | consumed | released | reversed)',
  labelNames: ['status'],
  registers: [register],
})

export const offersPreviewRejectionsTotal = new Counter({
  name: 'offers_preview_rejections_total',
  help: 'Typed offer codes that did not apply, by reason code',
  labelNames: ['reason'],
  registers: [register],
})

export const offersReserveRefusedTotal = new Counter({
  name: 'offers_reserve_refused_total',
  help: 'Reservations refused at booking (BUDGET | GLOBAL_LIMIT | USER_LIMIT | DISABLED)',
  labelNames: ['reason'],
  registers: [register],
})

export const offersBudgetRemaining = new Gauge({
  name: 'offers_budget_remaining',
  help: 'Rupees left in each live offer budget (offers with a budget only), refreshed by the reservation sweep',
  labelNames: ['offer'],
  registers: [register],
})
