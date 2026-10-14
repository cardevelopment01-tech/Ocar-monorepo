import { describe, it, expect } from 'vitest'
import { walletGateState } from './walletGateState'

const base = { loading: false, balance: 900, isFrozen: false, minBalance: 500, billingMode: 'commission' as const }

describe('walletGateState', () => {
  it('lets a driver at or above the server minimum go online', () => {
    expect(walletGateState({ ...base, balance: 500 }).canGoOnline).toBe(true)
    expect(walletGateState(base)).toMatchObject({ canGoOnline: true, isLow: false })
  })
  it('blocks and flags a low balance just under the minimum', () => {
    expect(walletGateState({ ...base, balance: 499 })).toMatchObject({ canGoOnline: false, isLow: true })
  })
  it('treats a negative balance as dues owed and blocks it while a minimum applies', () => {
    expect(walletGateState({ ...base, balance: -40 })).toMatchObject({ canGoOnline: false, duesOwed: -40, isLow: false })
  })
  it('does not block anyone when the server minimum is the testing value', () => {
    expect(walletGateState({ ...base, balance: -300, minBalance: -999999 })).toMatchObject({ canGoOnline: true, isLow: false })
  })
  it('does not gate on its own guess when the server did not send a minimum', () => {
    expect(walletGateState({ ...base, balance: 0, minBalance: null }).canGoOnline).toBe(true)
  })
  it('never gates a package-billing driver on the balance', () => {
    expect(walletGateState({ ...base, balance: 0, billingMode: 'package' })).toMatchObject({ canGoOnline: true, minBalance: null })
  })
  it('always blocks a frozen wallet, and stays open while loading', () => {
    expect(walletGateState({ ...base, isFrozen: true }).canGoOnline).toBe(false)
    expect(walletGateState({ ...base, loading: true, balance: 0 }).canGoOnline).toBe(true)
  })
})
