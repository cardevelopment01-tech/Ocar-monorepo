import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Check, TrendingDown, TrendingUp, Wallet as WalletIcon, AlertTriangle } from 'lucide-react'
import StatusBar from '@/components/ui/StatusBar'
import { useSessionStore } from '@/store/useSessionStore'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

interface PackageTier {
  id: number
  label: string
  price: string
  threshold_value: string
}

interface PackageWallet {
  balance: string
  is_frozen: boolean
  lifetime_topup: string
  lifetime_consumed: string
}

const TERMS = [
  'Credit is added to your ride balance instantly',
  "Used automatically to settle each ride's fare",
  'Credit never expires',
  'Purchases are non-refundable',
]

function Stat({ icon: Icon, label, value, tone }: {
  icon: typeof WalletIcon
  label: string
  value: string
  tone: 'default' | 'danger'
}) {
  return (
    <div className="flex-1 rounded-2xl bg-surface-2 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={13} className={tone === 'danger' ? 'text-accent-red' : 'text-text-muted'} aria-hidden="true" />
        <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className={cn('font-bold text-base tabular-nums', tone === 'danger' ? 'text-accent-red' : 'text-text-primary')}>
        {value}
      </p>
    </div>
  )
}

export default function RechargePackage() {
  const navigate = useNavigate()
  const { isOnline } = useSessionStore()
  const [tiers, setTiers] = useState<PackageTier[]>([])
  const [wallet, setWallet] = useState<PackageWallet | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [buying, setBuying] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const prefersReducedMotion = useReducedMotion()

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const [tiersRes, walletRes] = await Promise.all([
        api.get<PackageTier[]>('/api/v1/payments/packages/tiers'),
        api.get<PackageWallet>('/api/v1/payments/packages/wallet'),
      ])
      setTiers(tiersRes.data)
      setWallet(walletRes.data)
      setSelectedId(prev => prev ?? tiersRes.data[0]?.id ?? null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const selectedTier = tiers.find(t => t.id === selectedId) ?? null

  const handleBuy = async () => {
    if (!selectedTier) return
    setBuying(true)
    setMsg(null)
    try {
      const res = await api.post<{ dev?: boolean; credited?: number; orderId?: string; amount?: number; key?: string }>(
        '/api/v1/payments/packages/purchase/order',
        { tierId: selectedTier.id }
      )
      if (res.data.dev) {
        setMsg(`₹${selectedTier.threshold_value} ride credit added!`)
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
        description: `Package: ${selectedTier.label}`,
        // Crediting happens server-side off the Razorpay webhook, not here —
        // there's no /packages/purchase/verify endpoint. Refetch after a
        // short delay to give the webhook time to land, but don't claim
        // the balance is credited yet.
        handler: () => {
          setMsg('Payment received — your ride credit will appear shortly.')
          setTimeout(() => void load(), 3000)
        },
      })
      rzp.open()
    } catch {
      setMsg('Payment failed. Please try again.')
    } finally {
      setBuying(false)
    }
  }

  const balance   = wallet ? parseFloat(wallet.balance) : 0
  const purchased = wallet ? parseFloat(wallet.lifetime_topup) : 0
  const used      = wallet ? parseFloat(wallet.lifetime_consumed) : 0
  // Balance can dip negative (a ride's fare can exceed what's left — see
  // migration 078) — clamp the bar's remaining fraction at 0 rather than
  // letting it visually invert.
  const remainingPct = purchased > 0 ? Math.max(0, Math.min(100, (balance / purchased) * 100)) : 0
  const isLow = purchased > 0 && remainingPct < 20
  const isEmpty = purchased === 0

  return (
    // No BottomNav on this route — it's a sub-page reached from Wallet, not a
    // primary tab. The sticky pay bar below owns the bottom of the screen.
    <div className="min-h-screen bg-bg text-text-primary pb-40">
      <StatusBar isOnline={isOnline} earningsToday={0} />

      {/* Header — back arrow is the only way out of this sub-page */}
      <div className="flex items-center gap-3 px-5 pt-[64px] pb-3">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-border flex items-center justify-center cursor-pointer hover:bg-surface-2 transition-colors flex-shrink-0"
          aria-label="Go back"
        >
          <ArrowLeft size={18} className="text-text-primary" aria-hidden="true" />
        </button>
        <div>
          <h1 className="font-display font-bold text-xl text-text-primary">Ride Credit</h1>
          <p className="text-text-muted text-xs mt-0.5">Prepaid balance for rides</p>
        </div>
      </div>

      {loading ? (
        <div className="mx-5 rounded-3xl h-44 mb-4 skeleton" />
      ) : (
        <>
          {/* Balance card + threshold bar */}
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="mx-5 rounded-3xl p-5 mb-4"
              style={{
                background: isLow || wallet?.is_frozen
                  ? 'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)'
                  : 'linear-gradient(135deg, #087C89 0%, #0A9FB0 100%)',
                boxShadow: isLow || wallet?.is_frozen
                  ? '0 8px 28px rgba(217,119,6,0.22)'
                  : '0 8px 28px rgba(10,159,176,0.28)',
              }}
            >
              <div className="flex items-start justify-between mb-1">
                <p className="text-white/65 text-[13px] font-semibold">Available to ride</p>
                {wallet?.is_frozen && (
                  <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white">
                    <AlertTriangle size={11} aria-hidden="true" />
                    Frozen
                  </span>
                )}
              </div>
              <p className="text-white font-black text-[38px] leading-none tabular-nums">
                ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>

              {/* Threshold bar: remaining vs. total ever purchased */}
              <div className="mt-4">
                {isEmpty ? (
                  <p className="text-white/70 text-xs">Choose a package below to start riding on credit</p>
                ) : (
                  <>
                    <div className="h-2.5 rounded-full bg-white/20 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-white"
                        initial={prefersReducedMotion ? false : { width: 0 }}
                        animate={{ width: `${remainingPct}%` }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-white/70 text-[12px] font-medium">
                        ₹{used.toLocaleString('en-IN', { maximumFractionDigits: 0 })} used
                      </p>
                      <p className="text-white/90 text-[12px] font-bold">
                        {Math.round(remainingPct)}% left of ₹{purchased.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>

          {/* Stat separation: purchased / used / available, at a glance */}
          <motion.div
            className="mx-5 flex gap-2.5 mb-5"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <Stat icon={TrendingUp}   label="Purchased" value={`₹${purchased.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tone="default" />
            <Stat icon={TrendingDown} label="Used"       value={`₹${used.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}      tone="default" />
            <Stat icon={WalletIcon}   label="Left"        value={`₹${balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}   tone={balance < 0 ? 'danger' : 'default'} />
          </motion.div>
        </>
      )}

      {/* Plan selection */}
      <div className="px-5 mb-5">
        <p className="text-text-secondary text-sm font-semibold mb-3">Choose a package</p>

        {error && (
          <p className="text-text-muted text-sm text-center py-4">
            Failed to load packages.{' '}
            <button onClick={() => void load()} className="text-primary underline cursor-pointer">Retry</button>
          </p>
        )}

        {!error && !loading && tiers.length === 0 && (
          <p className="text-text-muted text-sm text-center py-4">No packages available right now</p>
        )}

        {msg && (
          <p className={cn('text-sm text-center mb-3 font-semibold',
            msg.includes('added') || msg.includes('shortly') ? 'text-accent-green' : 'text-accent-red'
          )}>{msg}</p>
        )}

        <div className="space-y-2.5">
          {tiers.map((t, i) => {
            const price = parseFloat(t.price)
            const threshold = parseFloat(t.threshold_value)
            const multiplier = price > 0 ? threshold / price : 0
            const selected = t.id === selectedId
            return (
              <motion.button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  'w-full flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left border-2 transition-colors cursor-pointer',
                  selected ? 'border-primary bg-primary-subtle' : 'border-border-light bg-white hover:border-primary/30'
                )}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                aria-pressed={selected}
              >
                <div className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                  selected ? 'border-primary bg-primary' : 'border-border'
                )}>
                  {selected && <Check size={12} className="text-white" strokeWidth={3} aria-hidden="true" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary font-bold text-base tabular-nums">
                    ₹{t.threshold_value} <span className="text-text-muted font-medium text-xs">ride credit</span>
                  </p>
                  <p className="text-text-muted text-xs mt-0.5">
                    Pay ₹{t.price}{multiplier >= 1.05 ? ` · ${multiplier.toFixed(1)}× value` : ''}
                  </p>
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Terms */}
      {!loading && tiers.length > 0 && (
        <div className="px-5 mb-6">
          <p className="text-text-secondary text-sm font-semibold mb-2">Terms</p>
          <ul className="space-y-1.5">
            {TERMS.map(term => (
              <li key={term} className="flex gap-2 text-text-muted text-xs leading-relaxed">
                <span aria-hidden="true">•</span>
                {term}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sticky pay bar */}
      {!loading && tiers.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 bg-white border-t border-border px-5 pt-3"
          style={{
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
            boxShadow: '0 -4px 24px rgba(10,159,176,0.10)',
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-text-muted text-xs font-medium">You pay</p>
            <p className="text-text-primary font-bold text-lg tabular-nums">₹{selectedTier?.price ?? '0'}</p>
          </div>
          <button
            onClick={() => void handleBuy()}
            disabled={!selectedTier || buying}
            className="btn-go w-full"
            style={{ minHeight: 52 }}
          >
            {buying ? 'Processing…' : `Recharge ₹${selectedTier?.threshold_value ?? '0'} Credit`}
          </button>
        </div>
      )}
    </div>
  )
}
