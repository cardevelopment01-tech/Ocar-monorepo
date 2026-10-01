import { describe, expect, it } from 'vitest'
import { buildInvoiceRows, formatMoney, paymentState, tripMetrics } from './tripSummaryModel'

const base = {
  baseFare: '120.00', distanceFare: '1020.00', timeFare: '290.00', stopFare: '0.00', hourSurcharge: '0.00',
  overageFare: '0.00', surgeFare: '0.00', surgeMultiplier: '1.00', actualKm: '28.40', actualMin: '58.00',
  totalFinal: '1430.00', totalEstimated: '1400.00',
}

describe('formatMoney', () => {
  it('drops .00 and groups in lakh style', () => {
    expect(formatMoney('1480.00')).toBe('₹1,480')
    expect(formatMoney(123456)).toBe('₹1,23,456')
  })
  it('keeps paise', () => {
    expect(formatMoney('146.82')).toBe('₹146.82')
  })
})

describe('buildInvoiceRows', () => {
  it('hides zero rows, labels quantities, and sums to the total', () => {
    const { rows, total } = buildInvoiceRows(base)
    expect(rows.map((r) => r.key)).toEqual(['base', 'distance', 'time'])
    expect(rows[1]!.label).toBe('Distance · 28.4 km')
    expect(total).toBe(1430)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total)
  })
  it('shows surge only when charged', () => {
    const { rows } = buildInvoiceRows({ ...base, surgeFare: '100.00', surgeMultiplier: '1.20', totalFinal: '1530.00' })
    expect(rows.find((r) => r.key === 'surge')!.label).toBe('Surge · 1.2x')
  })
  it('adds an Adjustments row when components do not reach the total', () => {
    const { rows } = buildInvoiceRows({ ...base, totalFinal: '1400.00' })
    expect(rows.at(-1)).toMatchObject({ key: 'adjust', label: 'Adjustments', amount: -30 })
  })
  it('ignores sub-rupee rounding gaps', () => {
    expect(buildInvoiceRows({ ...base, totalFinal: '1430.50' }).rows.some((r) => r.key === 'adjust')).toBe(false)
  })
  it('falls back to the estimate and flags it', () => {
    const r = buildInvoiceRows({ ...base, totalFinal: null })
    expect(r.isEstimate).toBe(true)
    expect(r.total).toBe(1400)
  })
})

describe('paymentState', () => {
  const ride = { totalFinal: '1480.00', totalEstimated: '1400.00', paymentChannel: 'cash', cashCollectedAt: null }
  it('cash not collected is due, with the formatted amount', () => {
    expect(paymentState(ride)).toEqual({ kind: 'cash_due', text: 'Pay ₹1,480 cash to your driver' })
  })
  it('cash collected is paid', () => {
    expect(paymentState({ ...ride, cashCollectedAt: '2026-10-01T16:10:00Z' }).kind).toBe('paid')
  })
  it('null channel is treated as cash', () => {
    expect(paymentState({ ...ride, paymentChannel: null }).kind).toBe('cash_due')
  })
  it('wallet is paid', () => {
    expect(paymentState({ ...ride, paymentChannel: 'wallet' })).toEqual({ kind: 'paid', text: 'Paid via wallet' })
  })
})

describe('tripMetrics', () => {
  it('joins duration, distance and stops', () => {
    expect(tripMetrics({ actualKm: '28.40', actualMin: '58.00' }, 1)).toBe('58 min · 28.4 km · 1 stop')
  })
  it('returns null when nothing is known', () => {
    expect(tripMetrics({ actualKm: null, actualMin: null }, 0)).toBeNull()
  })
})
