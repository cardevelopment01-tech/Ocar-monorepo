import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react'
import StatusBar from '@/components/ui/StatusBar'
import { useSessionStore } from '@/store/useSessionStore'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

const MIN_BALANCE = 500

interface LedgerEntry {
  id: string
  entry_type: string
  amount: string
  direction: 'credit' | 'debit'
  balance_after: string
  ride_id: string | null
  note: string | null
  created_at: string
}

interface DriverWallet {
  balance: string
  lifetime_topup: string
  lifetime_commission: string
  is_frozen: boolean
  recent_ledger: LedgerEntry[] | null
}

function entryLabel(e: LedgerEntry): string {
  switch (e.entry_type) {
    case 'commission_debit':   return e.note ?? 'Commission deduction'
    case 'topup':              return 'Wallet top-up'
    case 'adjustment_credit':  return 'Admin credit adjustment'
    case 'adjustment_debit':   return 'Admin debit adjustment'
    case 'refund_credit':      return 'Refund credit'
    default:                   return e.entry_type.replace(/_/g, ' ')
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function Wallet() {
  const { isOnline } = useSessionStore()
  const [wallet,         setWallet]         = useState<DriverWallet | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(false)
  const [selectedAmount, setSelectedAmount] = useState(1000)
  const [topupLoading,   setTopupLoading]   = useState(false)
  const [topupMsg,       setTopupMsg]       = useState<string | null>(null)
  const prefersReducedMotion = useReducedMotion()

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await api.get<DriverWallet>('/api/v1/payments/wallet/driver')
      setWallet(res.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const handleAddMoney = async () => {
    setTopupLoading(true)
    setTopupMsg(null)
    try {
      const res = await api.post<{ dev?: boolean; credited?: number; orderId?: string; amount?: number; key?: string }>(
        '/api/v1/payments/wallet/driver/topup/order',
        { amount: selectedAmount }
      )
      if (res.data.dev) {
        setTopupMsg(`₹${selectedAmount.toLocaleString('en-IN')} added successfully!`)
        void load()
        return
      }
      // Razorpay checkout
      await new Promise<void>((resolve, reject) => {
        if (document.getElementById('rzp-script')) { resolve(); return }
        const s = document.createElement('script')
        s.id = 'rzp-script'
        s.src = 'https://checkout.razorpay.com/v1/checkout.js'
        s.onload = () => resolve()
        s.onerror = reject
        document.body.appendChild(s)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rzp = new (window as any).Razorpay({
        key: res.data.key,
        order_id: res.data.orderId,
        amount: (res.data.amount ?? 0) * 100,
        currency: 'INR',
        name: 'Ocar',
        description: 'Wallet Top-up',
        handler: async (response: { razorpay_payment_id: string; razorpay_signature: string }) => {
          await api.post('/api/v1/payments/wallet/driver/topup/verify', {
            orderId: res.data.orderId,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
            amount: selectedAmount,
          })
          setTopupMsg(`₹${selectedAmount.toLocaleString('en-IN')} added successfully!`)
          void load()
        },
      })
      rzp.open()
    } catch {
      setTopupMsg('Payment failed. Please try again.')
    } finally {
      setTopupLoading(false)
    }
  }

  const balance = wallet ? parseFloat(wallet.balance) : 0
  const isLow   = balance < MIN_BALANCE
  const ledger  = wallet?.recent_ledger ?? []

  return (
    <div className="min-h-screen bg-bg text-text-primary pb-24">
      <StatusBar isOnline={isOnline} earningsToday={0} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-[64px] pb-2">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Wallet</h1>
          <p className="text-text-muted text-sm mt-0.5">Compliance deposit</p>
        </div>
        {!loading && (
          <button
            onClick={() => void load()}
            className="w-10 h-10 rounded-full bg-white border border-border flex items-center justify-center cursor-pointer hover:bg-surface-2 transition-colors"
            aria-label="Refresh wallet"
          >
            <RefreshCw size={15} className="text-text-secondary" aria-hidden="true" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="mx-5 rounded-3xl h-36 mb-4 skeleton" />
      ) : (
        <>
          {/* Balance card */}
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="mx-5 rounded-3xl p-6 mb-4"
              style={{
                background: isLow
                  ? 'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)'
                  : 'linear-gradient(135deg, #16A34A 0%, #22C55E 100%)',
                boxShadow: isLow
                  ? '0 8px 28px rgba(217,119,6,0.22)'
                  : '0 8px 28px rgba(34,197,94,0.22)',
              }}
            >
              <p className="text-white/60 text-[13px] font-semibold mb-1">
                Compliance deposit
              </p>
              <p className="text-white font-black text-[44px] leading-none tabular-nums">
                ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-white/60 text-xs mt-2">
                Minimum required: ₹{MIN_BALANCE.toLocaleString('en-IN')}
              </p>
            </div>
          </motion.div>

          {isLow && (
            <div
              className="mx-5 rounded-2xl px-4 py-3 flex items-center gap-3 mb-4"
              style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.20)' }}
              role="alert"
            >
              <AlertTriangle size={18} className="text-accent-amber flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-accent-amber font-bold text-sm">Low Balance</p>
                <p className="text-text-secondary text-xs mt-0.5">
                  Add ₹{(MIN_BALANCE - balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} to avoid service interruption
                </p>
              </div>
            </div>
          )}

          {wallet?.is_frozen && (
            <div
              className="mx-5 rounded-2xl px-4 py-3 flex items-center gap-3 mb-4"
              style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)' }}
              role="alert"
            >
              <AlertTriangle size={18} className="text-accent-red flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-accent-red font-bold text-sm">Wallet Frozen</p>
                <p className="text-text-secondary text-xs mt-0.5">Contact support to unfreeze your wallet</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add money */}
      <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border">
        <p className="text-text-secondary text-sm font-semibold mb-3">Add Money</p>
        <div className="flex gap-2 mb-4 flex-wrap">
          {[500, 1000, 2000, 5000].map(amt => (
            <button
              key={amt}
              onClick={() => setSelectedAmount(amt)}
              className={cn(
                'border rounded-2xl px-4 py-2 text-sm font-bold transition-colors cursor-pointer',
                selectedAmount === amt
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface-2 border-border text-text-secondary hover:border-primary hover:text-primary hover:bg-primary/5'
              )}
            >
              +₹{amt.toLocaleString('en-IN')}
            </button>
          ))}
        </div>
        {topupMsg && (
          <p className={cn('text-sm text-center mb-3 font-semibold',
            topupMsg.includes('success') ? 'text-accent-green' : 'text-accent-red'
          )}>{topupMsg}</p>
        )}
        <button
          onClick={() => void handleAddMoney()}
          disabled={topupLoading}
          className="btn-go w-full"
          style={{ minHeight: 52 }}
        >
          {topupLoading ? 'Processing…' : `Add ₹${selectedAmount.toLocaleString('en-IN')} via UPI`}
        </button>
      </div>

      {/* Transactions */}
      <div className="mx-5 bg-white rounded-3xl p-5 border border-border">
        <p className="text-text-secondary text-sm font-semibold mb-4">Recent Transactions</p>

        {error && (
          <p className="text-text-muted text-sm text-center py-4">
            Failed to load transactions.{' '}
            <button onClick={() => void load()} className="text-primary underline cursor-pointer">Retry</button>
          </p>
        )}

        {!error && ledger.length === 0 && !loading && (
          <p className="text-text-muted text-sm text-center py-4">No transactions yet</p>
        )}

        {ledger.map((tx, index) => (
          <motion.div
            key={tx.id}
            className="flex items-center gap-3 py-3 border-b border-border last:border-0"
            initial={prefersReducedMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
              tx.direction === 'credit' ? 'bg-accent-green/10' : 'bg-accent-red/10'
            )}>
              {tx.direction === 'credit'
                ? <ArrowDownLeft size={16} className="text-accent-green" aria-hidden="true" />
                : <ArrowUpRight  size={16} className="text-accent-red"   aria-hidden="true" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-sm font-semibold truncate">{entryLabel(tx)}</p>
              <p className="text-text-muted text-xs mt-0.5">{formatDate(tx.created_at)}</p>
            </div>
            <p className={cn(
              'font-bold text-sm flex-shrink-0 tabular-nums',
              tx.direction === 'credit' ? 'text-accent-green' : 'text-accent-red'
            )}>
              {tx.direction === 'credit' ? '+' : '-'}₹{parseFloat(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
