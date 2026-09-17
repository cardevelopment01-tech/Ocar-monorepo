import { useEffect, useState } from 'react'
import { fetchWalletInfo } from './api'

// Mirror of apps/driver/src/lib/useWalletGate.ts -- proactive client-side check so a
// driver sees a blocked state before tapping "Go Online". Server is authoritative
// (goOnline() re-checks wallet balance/freeze regardless).
// ponytail: MIN_BALANCE mirrors the same temporarily-disabled -999999 value as the
// web app's useWalletGate.ts and Wallet.tsx -- see CLAUDE.md's "Pending Ops Actions"
// for the client-testing context and the exact revert steps.
const MIN_BALANCE = -999999

export type WalletGate = {
  loading: boolean
  balance: number
  isFrozen: boolean
  isLow: boolean
  duesOwed: number | null
  canGoOnline: boolean
}

export function useWalletGate(): WalletGate {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [isFrozen, setIsFrozen] = useState(false)

  useEffect(() => {
    fetchWalletInfo()
      .then((info) => {
        setBalance(info.balance)
        setIsFrozen(info.isFrozen)
      })
      .catch(() => {
        // fail open -- server still enforces the block on goOnline()
      })
      .finally(() => setLoading(false))
  }, [])

  const isLow = !isFrozen && balance >= 0 && balance < MIN_BALANCE
  const duesOwed = !isFrozen && balance < 0 ? balance : null

  return {
    loading,
    balance,
    isFrozen,
    isLow,
    duesOwed,
    canGoOnline: loading || (!isFrozen && balance >= MIN_BALANCE),
  }
}
