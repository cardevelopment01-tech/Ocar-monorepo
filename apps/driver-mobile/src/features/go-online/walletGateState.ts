// Pure rules behind the wallet gate, so they can be unit-tested. The minimum comes from the server
// (GET /payments/wallet/driver -> min_balance) rather than a copy in the app, so the app's go-online block and its
// low-balance warnings always agree with what the server enforces. Only commission-billing drivers have a balance gate:
// a package driver, or one whose billing mode could not be read, is never blocked on a guess.
export type WalletGateInput = {
  loading: boolean
  balance: number
  isFrozen: boolean
  /** null = the server did not say, so the app does not gate on its own guess. */
  minBalance: number | null
  billingMode: 'commission' | 'package' | null
}

export type WalletGateState = {
  minBalance: number | null
  isLow: boolean
  duesOwed: number | null
  canGoOnline: boolean
}

export function walletGateState(i: WalletGateInput): WalletGateState {
  const min = i.billingMode === 'commission' ? i.minBalance : null
  const belowMin = min !== null && i.balance < min
  return {
    minBalance: min,
    isLow: !i.isFrozen && belowMin && i.balance >= 0,
    duesOwed: !i.isFrozen && i.balance < 0 ? i.balance : null,
    canGoOnline: i.loading || (!i.isFrozen && !belowMin),
  }
}
