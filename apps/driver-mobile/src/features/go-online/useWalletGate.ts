import { useEffect, useState } from 'react'
import { fetchWalletInfo } from './api'
import { fetchBillingMode } from '@/features/wallet/api'
import { fetchPackageWallet } from '@/features/payments/api'
import { walletGateState } from './walletGateState'

// Proactive client-side check so a driver sees a blocked state before tapping "Go Online". The server is
// authoritative (goOnline() re-checks the balance and freeze regardless), and the minimum itself comes from the
// server, so flipping system_config.driver_minimum_balance changes this gate with no app release.

export type WalletGate = {
  loading: boolean
  balance: number
  isFrozen: boolean
  isLow: boolean
  duesOwed: number | null
  canGoOnline: boolean
  minBalance: number | null
  /** For a package-billing driver: their ride credit (what the pill shows) and whether it is used up (no ride requests until they recharge). */
  packageCredit: { balance: number; exhausted: boolean } | null
}

export function useWalletGate(): WalletGate {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [isFrozen, setIsFrozen] = useState(false)
  const [minBalance, setMinBalance] = useState<number | null>(null)
  const [billingMode, setBillingMode] = useState<'commission' | 'package' | null>(null)
  const [packageBalance, setPackageBalance] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([fetchWalletInfo(), fetchBillingMode().catch(() => null)])
      .then(async ([info, mode]) => {
        setBalance(info.balance)
        setIsFrozen(info.isFrozen)
        setMinBalance(info.minBalance)
        setBillingMode(mode)
        if (mode === 'package') {
          // Best effort: without it the pill just shows the commission wallet figure, as before.
          const pkg = await fetchPackageWallet().catch(() => null)
          if (pkg) setPackageBalance(parseFloat(pkg.balance))
        }
      })
      .catch(() => {
        // fail open -- server still enforces the block on goOnline()
      })
      .finally(() => setLoading(false))
  }, [])

  const state = walletGateState({ loading, balance, isFrozen, minBalance, billingMode })
  const packageCredit = billingMode === 'package' && packageBalance !== null ? { balance: packageBalance, exhausted: packageBalance <= 0 } : null
  return { loading, balance: packageCredit ? packageCredit.balance : balance, isFrozen, ...state, packageCredit }
}
