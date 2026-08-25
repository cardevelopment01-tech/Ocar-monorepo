'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
}
const stagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
}
const rowVariant = {
  hidden: { opacity: 0, x: -8 },
  show:   { opacity: 1, x: 0, transition: { duration: 0.26, ease: EASE } },
}

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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtExpiry(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return d < new Date() ? 'Expired' : `Expires ${fmtDate(iso)}`
}

export default function WalletPage() {
  const [wallet,  setWallet]  = useState<UserWallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

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
    <div className="h-full flex flex-col bg-background">

      {/* ── Dark balance hero ── */}
      <motion.div
        className="flex-shrink-0 px-5 pt-safe-top pb-7"
        style={{
          background: 'linear-gradient(160deg, #0F0F23 0%, #1E1B4B 100%)',
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
        }}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.44, ease: EASE }}
      >
        <div className="flex items-center gap-3 mt-4 mb-5">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(99,102,241,0.30)' }}
          >
            <Wallet size={18} color="rgba(255,255,255,0.85)" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.48)' }}>Ocar Wallet</p>
            <p className="text-sm font-semibold text-white">Cashback & referral credits</p>
          </div>
        </div>

        {loading ? (
          <div className="h-10 w-36 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.12)' }} />
        ) : (
          <p className="text-4xl font-bold text-white tracking-tight">
            ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
        )}

        <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.40)' }}>
          Lifetime earned: ₹{parseFloat(wallet?.lifetime_earned ?? '0').toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </p>
      </motion.div>

      {/* ── Transactions ── */}
      <motion.div
        className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        <motion.p variants={fadeUp} className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">
          Transactions
        </motion.p>

        {error && (
          <motion.p variants={fadeUp} className="text-center text-sm text-text-muted py-12">
            Failed to load wallet data.
          </motion.p>
        )}

        {!error && !loading && ledger.length === 0 && (
          <motion.div variants={fadeUp} className="flex flex-col items-center justify-center py-16 gap-3">
            <Wallet size={36} className="text-text-muted opacity-25" />
            <p className="text-sm text-text-muted text-center">
              No transactions yet.<br />Complete a ride to earn cashback!
            </p>
          </motion.div>
        )}

        {!error && (
          loading ? (
            <div className="card p-0 overflow-hidden">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 px-4 py-4 border-b border-border last:border-0 animate-pulse">
                  <div className="w-9 h-9 rounded-xl bg-surface-2 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="h-3.5 w-32 bg-surface-2 rounded mb-1.5" />
                    <div className="h-3 w-20 bg-surface-2 rounded" />
                  </div>
                  <div className="h-3.5 w-14 bg-surface-2 rounded" />
                </div>
              ))}
            </div>
          ) : ledger.length > 0 && (
            <motion.div
              className="card p-0 overflow-hidden"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
              initial="hidden"
              animate="show"
            >
              {ledger.map((tx, i) => {
                const expiry = fmtExpiry(tx.expires_at)
                return (
                  <motion.div
                    key={tx.id}
                    variants={rowVariant}
                    className={cn('flex items-center gap-3 px-4 py-3.5', i < ledger.length - 1 ? 'border-b border-border' : '')}
                  >
                    <span className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                      tx.direction === 'credit' ? 'bg-status-success/10' : 'bg-status-error/10',
                    )}>
                      {tx.direction === 'credit'
                        ? <ArrowDownLeft size={16} className="text-status-success" strokeWidth={2} />
                        : <ArrowUpRight  size={16} className="text-status-error"   strokeWidth={2} />
                      }
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{entryLabel(tx)}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {fmtDate(tx.created_at)}
                        {expiry && (
                          <span className={cn('ml-1.5', expiry === 'Expired' ? 'text-status-error' : '')}>
                            · {expiry}
                          </span>
                        )}
                      </p>
                    </div>
                    <p className={cn(
                      'text-sm font-bold flex-shrink-0 tabular-nums',
                      tx.direction === 'credit' ? 'text-status-success' : 'text-status-error',
                    )}>
                      {tx.direction === 'credit' ? '+' : '-'}₹{parseFloat(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  </motion.div>
                )
              })}
            </motion.div>
          )
        )}
      </motion.div>
    </div>
  )
}
