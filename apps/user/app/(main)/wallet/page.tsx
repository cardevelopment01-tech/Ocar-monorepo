'use client'

import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

interface LedgerEntry {
  id: string
  entry_type: string
  amount: string
  direction: 'credit' | 'debit'
  balance_after: string
  ride_id: string | null
  expires_at: string | null
  note: string | null
  created_at: string
}

interface UserWallet {
  balance: string
  lifetime_earned: string
  recent_ledger: LedgerEntry[] | null
}

function entryLabel(e: LedgerEntry): string {
  switch (e.entry_type) {
    case 'cashback':          return e.note ?? 'Ride cashback'
    case 'referral_bonus':    return 'Referral bonus'
    case 'ride_debit':        return 'Ride payment'
    case 'adjustment_credit': return 'Credit adjustment'
    case 'adjustment_debit':  return 'Debit adjustment'
    case 'refund_credit':     return 'Refund'
    default:                  return e.entry_type.replace(/_/g, ' ')
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (d < new Date()) return 'Expired'
  return `Expires ${formatDate(iso)}`
}

export default function WalletPage() {
  const [wallet, setWallet]   = useState<UserWallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get<UserWallet>('/api/v1/payments/wallet/user')
        setWallet(res.data)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const balance = wallet ? parseFloat(wallet.balance) : 0
  const ledger  = wallet?.recent_ledger ?? []

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Balance card */}
      <div className="bg-primary px-6 pt-safe-top pb-8 rounded-b-3xl">
        <h1 className="text-white/70 text-sm font-medium pt-6 mb-2">Ocar Wallet</h1>
        {loading ? (
          <div className="h-10 w-32 bg-white/20 rounded-xl animate-pulse mb-1" />
        ) : (
          <p className="text-4xl font-bold text-white mb-1">
            ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
        )}
        <p className="text-white/60 text-xs">Cashback & referral credits</p>

        <button className="mt-6 bg-white rounded-2xl px-6 py-3 flex items-center gap-2 w-full justify-center font-semibold text-primary shadow-button opacity-50 cursor-not-allowed">
          <Plus size={18} />
          Add Money (Coming soon)
        </button>
      </div>

      {/* Transactions */}
      <div className="px-4 mt-6">
        <h2 className="text-sm font-bold text-text-primary mb-3">Transactions</h2>

        {error && (
          <p className="text-text-muted text-sm text-center py-8">Failed to load wallet data.</p>
        )}

        {!error && !loading && ledger.length === 0 && (
          <p className="text-text-muted text-sm text-center py-8">
            No transactions yet. Complete a ride to earn cashback!
          </p>
        )}

        {!error && (loading ? (
          <div className="card p-0 divide-y divide-border">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-4">
                <div className="w-10 h-10 rounded-xl bg-surface animate-pulse" />
                <div className="flex-1">
                  <div className="h-4 w-32 bg-surface rounded animate-pulse mb-1" />
                  <div className="h-3 w-20 bg-surface rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-0 divide-y divide-border">
            {ledger.map(tx => {
              const expiry = formatExpiry(tx.expires_at)
              return (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-4">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                    tx.direction === 'credit' ? 'bg-status-success/10' : 'bg-status-error/10'
                  )}>
                    {tx.direction === 'credit'
                      ? <ArrowDownLeft size={18} className="text-status-success" />
                      : <ArrowUpRight size={18} className="text-status-error" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{entryLabel(tx)}</p>
                    <p className="text-xs text-text-muted">
                      {formatDate(tx.created_at)}
                      {expiry && (
                        <span className={cn('ml-2', expiry === 'Expired' ? 'text-status-error' : 'text-text-muted')}>
                          · {expiry}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className={cn(
                    'font-bold text-sm flex-shrink-0',
                    tx.direction === 'credit' ? 'text-status-success' : 'text-status-error'
                  )}>
                    {tx.direction === 'credit' ? '+' : '-'}₹{parseFloat(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
