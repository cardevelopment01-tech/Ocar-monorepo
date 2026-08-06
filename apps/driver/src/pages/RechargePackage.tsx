import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { PackageCheck, RefreshCw, TrendingDown, TrendingUp, Wallet as WalletIcon, AlertTriangle } from 'lucide-react'
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
  const { isOnline } = useSessionStore()
  const [tiers, setTiers] = useState<PackageTier[]>([])
  const [wallet, setWallet] = useState<PackageWallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [buyingId, setBuyingId] = useState<number | null>(null)
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
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const handleBuy = async (tier: PackageTier) => {
    setBuyingId(tier.id)
    setMsg(null)
    try {
      const res = await api.post<{ dev?: boolean; credited?: number; orderId?: string; amount?: number; key?: string }>(
        '/api/v1/payments/packages/purchase/order',
        { tierId: tier.id }
      )
      if (res.data.dev) {
        setMsg(`₹${tier.threshold_value} ride credit added!`)
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
        description: `Package: ${tier.label}`,
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
      setBuyingId(null)
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
    <div className="min-h-screen bg-bg text-text-primary pb-24">
      <StatusBar isOnline={isOnline} earningsToday={0} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-[64px] pb-2">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Ride Credit</h1>
          <p className="text-text-muted text-sm mt-0.5">Prepaid package balance</p>
        </div>
        {!loading && (
          <button
            onClick={() => void load()}
            className="w-10 h-10 rounded-full bg-white border border-border flex items-center justify-center cursor-pointer hover:bg-surface-2 transition-colors"
            aria-label="Refresh package balance"
          >
            <RefreshCw size={15} className="text-text-secondary" aria-hidden="true" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="mx-5 rounded-3xl h-52 mb-4 skeleton" />
      ) : (
        <>
          {/* Balance card + threshold bar */}
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="mx-5 rounded-3xl p-6 mb-4"
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
              <p className="text-white font-black text-[44px] leading-none tabular-nums">
                ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>

              {/* Threshold bar: remaining vs. total ever purchased */}
              <div className="mt-5">
                {isEmpty ? (
                  <p className="text-white/70 text-xs">Buy a package below to start riding on credit</p>
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
            className="mx-5 flex gap-2.5 mb-4"
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

      {/* Buy a package */}
      <div className="card-glossy mx-5 rounded-3xl p-5">
        <p className="text-text-secondary text-sm font-semibold mb-3">Buy a package</p>

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
            return (
              <motion.button
                key={t.id}
                onClick={() => void handleBuy(t)}
                disabled={buyingId === t.id}
                className="w-full flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left bg-surface-2 border border-transparent hover:border-primary/30 hover:bg-primary-subtle transition-colors cursor-pointer disabled:opacity-60"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <PackageCheck size={17} className="text-primary" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary font-semibold text-sm">{t.label}</p>
                  <p className="text-text-muted text-xs mt-0.5">
                    ₹{t.price} · {multiplier >= 1.05 ? `${multiplier.toFixed(1)}× ride credit` : 'ride credit'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {buyingId === t.id ? (
                    <span className="text-text-muted text-xs font-semibold">Processing…</span>
                  ) : (
                    <span className="text-text-primary font-bold text-sm tabular-nums">₹{t.threshold_value}</span>
                  )}
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
