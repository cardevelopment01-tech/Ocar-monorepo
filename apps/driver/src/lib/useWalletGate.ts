import { useEffect, useState } from 'react'
import api from '@/lib/api'

// Mirror of the API's driver_minimum_balance system_config value — same
// client-side-mirrored-constant convention as Wallet.tsx's MIN_BALANCE.
// Server is authoritative on whether goOnline() actually blocks.
// ponytail: temporarily 0 — client requested the recharge gate disabled for
// driver testing. Restore to 500 (and flip system_config.driver_minimum_balance
// back to '500') to re-enable.
const MIN_BALANCE = 0

interface WalletGate {
  loading: boolean
  balance: number
  isFrozen: boolean
  isLow: boolean
  duesOwed: number | null
  canGoOnline: boolean
}

// Shared by StandardConfirm.tsx and ReturnCabSetup.tsx so the low-balance
// block is visible on load instead of only after a failed goOnline() call.
export function useWalletGate(): WalletGate {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [isFrozen, setIsFrozen] = useState(false)

  useEffect(() => {
    api.get<{ balance: string; is_frozen: boolean }>('/api/v1/payments/wallet/driver')
      .then(res => {
        setBalance(parseFloat(res.data.balance))
        setIsFrozen(res.data.is_frozen)
      })
      .catch(() => { /* fail open — server still enforces the block on goOnline() */ })
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
