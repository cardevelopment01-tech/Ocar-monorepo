import { describe, expect, it } from 'vitest'
import { daysLeft, ledgerLine, packageStatus } from './packageStatus'

// Value: protects=a package driver is always told, in plain words, when their ride requests have stopped or are about to (no credit,
// overdrawn, running low, frozen, credit about to expire) and never gets a false alarm while they are fine; fails_when=a driver with
// no credit sees "Active", an overdrawn driver is told nothing, or a healthy one gets a warning; why_new=packages gained 365-day
// expiry and GST; seam=none (pure rules); no_claim=the layout or the server's offer gate.
const NOW = new Date('2026-11-21T10:00:00.000Z')
const lot = (remaining: string, days: number) => ({ remaining, expires_at: new Date(NOW.getTime() + days * 86_400_000).toISOString() })

describe('packageStatus', () => {
  it('healthy credit with nothing expiring soon has no notice', () => {
    expect(packageStatus({ balance: 550, frozen: false, lots: [lot('550', 300)], now: NOW })).toMatchObject({ state: 'active', chip: 'Active', notice: null, expiringSoon: null })
  })
  it('no credit: says requests have stopped and what to do', () => {
    const s = packageStatus({ balance: 0, frozen: false, lots: [], now: NOW })
    expect(s.state).toBe('empty')
    expect(s.notice).toMatchObject({ tone: 'error', title: 'No ride credit left' })
    expect(s.notice?.message).toContain('will not receive ride requests')
  })
  it('overdrawn: names the amount owed and says one recharge clears it first', () => {
    const s = packageStatus({ balance: -245, frozen: false, lots: [], now: NOW })
    expect(s.state).toBe('overdrawn')
    expect(s.notice?.title).toBe('You are ₹245 short')
    expect(s.notice?.message).toContain('Recharge to clear the ₹245')
  })
  it('low credit warns before it runs out, at the boundary', () => {
    expect(packageStatus({ balance: 99, frozen: false, lots: [lot('99', 200)], now: NOW }).state).toBe('low')
    expect(packageStatus({ balance: 100, frozen: false, lots: [lot('100', 200)], now: NOW }).state).toBe('active')
  })
  it('frozen beats everything: requests are on hold whatever the balance', () => {
    expect(packageStatus({ balance: 900, frozen: true, lots: [lot('900', 200)], now: NOW })).toMatchObject({ state: 'frozen', chip: 'On hold' })
  })
  it('credit expiring within 30 days is called out with its amount and days, soonest first', () => {
    const s = packageStatus({ balance: 1600, frozen: false, lots: [lot('1050', 200), lot('550', 12)], now: NOW })
    expect(s.state).toBe('active')
    expect(s.expiringSoon).toMatchObject({ amount: 550, daysLeft: 12 })
    expect(s.notice).toMatchObject({ tone: 'info', title: '₹550 expires in 12 days' })
    expect(packageStatus({ balance: 550, frozen: false, lots: [lot('550', 1)], now: NOW }).notice?.title).toBe('₹550 expires in 1 day')
  })
  it('a lot 31 days out is not yet a warning; a used-up lot never is', () => {
    expect(packageStatus({ balance: 550, frozen: false, lots: [lot('550', 31)], now: NOW }).notice).toBeNull()
    expect(packageStatus({ balance: 550, frozen: false, lots: [lot('0', 3), lot('550', 200)], now: NOW }).expiringSoon).toBeNull()
  })
  it('daysLeft rounds up and never goes negative', () => {
    expect(daysLeft(new Date(NOW.getTime() + 36 * 3_600_000).toISOString(), NOW)).toBe(2)
    expect(daysLeft(new Date(NOW.getTime() - 3_600_000).toISOString(), NOW)).toBe(0)
  })
})

describe('ledgerLine', () => {
  it('words each kind of entry for a driver', () => {
    expect(ledgerLine({ entry_type: 'topup', amount: '550', direction: 'credit', ride_id: null, note: null })).toEqual({ title: 'Ride credit added', subtitle: null, sign: '+' })
    expect(ledgerLine({ entry_type: 'ride_consumption', amount: '217', direction: 'debit', ride_id: '48213', note: null })).toEqual({ title: 'Ride #48213', subtitle: 'Used from your credit', sign: '−' })
    expect(ledgerLine({ entry_type: 'expiry', amount: '450', direction: 'debit', ride_id: null, note: 'Unused package credit ₹450 from 2026-11-21 expired' }).title).toBe('Credit expired')
    expect(ledgerLine({ entry_type: 'admin_adjustment', amount: '50', direction: 'credit', ride_id: null, note: 'Goodwill' })).toEqual({ title: 'Credit added by Ocar', subtitle: 'Goodwill', sign: '+' })
  })
})
