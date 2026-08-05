import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { PackageCheck, RefreshCw } from 'lucide-react'
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

  const balance = wallet ? parseFloat(wallet.balance) : 0

  return (
    <div className="min-h-screen bg-bg text-text-primary pb-24">
      <StatusBar isOnline={isOnline} earningsToday={0} />

      <div className="flex items-center justify-between px-5 pt-[64px] pb-2">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Recharge Package</h1>
          <p className="text-text-muted text-sm mt-0.5">Ride credit balance</p>
        </div>
        {!loading && (
          <button
            onClick={() => void load()}
            className="w-10 h-10 rounded-full bg-white border border-border flex items-center justify-center cursor-pointer hover:bg-surface-2 transition-colors"
            aria-label="Refresh package wallet"
          >
            <RefreshCw size={15} className="text-text-secondary" aria-hidden="true" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="mx-5 rounded-3xl h-36 mb-4 skeleton" />
      ) : (
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            className="mx-5 rounded-3xl p-6 mb-4"
            style={{
              background: 'linear-gradient(135deg, #16A34A 0%, #22C55E 100%)',
              boxShadow: '0 8px 28px rgba(34,197,94,0.22)',
            }}
          >
            <p className="text-white/60 text-[13px] font-semibold mb-1">Ride credit balance</p>
            <p className="text-white font-black text-[44px] leading-none tabular-nums">
              ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
            {wallet?.is_frozen && (
              <p className="text-white/80 text-xs mt-2">Frozen — contact support</p>
            )}
          </div>
        </motion.div>
      )}

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

        <div className="space-y-2">
          {tiers.map(t => (
            <button
              key={t.id}
              onClick={() => void handleBuy(t)}
              disabled={buyingId === t.id}
              className="gloss-sheen w-full flex items-center justify-between gap-3 border border-border rounded-2xl px-4 py-3 text-left bg-surface-2 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <PackageCheck size={16} className="text-primary" aria-hidden="true" />
                </div>
                <span className="text-text-primary font-semibold text-sm">{t.label}</span>
              </div>
              <span className="text-text-secondary text-sm font-bold flex-shrink-0">
                {buyingId === t.id ? 'Processing…' : `₹${t.price} → ₹${t.threshold_value} credit`}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
