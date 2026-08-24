import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import StatusBar from '@/components/ui/StatusBar'
import BankAccountSection from '@/components/BankAccountSection'
import { useSessionStore } from '@/store/useSessionStore'
import {
  driverRideApi, driverPayoutApi,
  type TripHistoryItem, type EarningsSummary, type DriverEarningsBalance, type DriverBankAccount,
} from '@/lib/ride-api'
import { cn } from '@/lib/utils'
import { Car } from 'lucide-react'

type Period = 'today' | 'week' | 'month'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
]

const EMPTY_SUMMARY: EarningsSummary = {
  total_earnings: 0, trip_count: 0, online_hours: '0m', rating: null,
  chart: Array(8).fill(0), chart_labels: ['12AM','3AM','6AM','9AM','12PM','3PM','6PM','9PM'],
  breakdown: { base_fare: 0, tips: 0, incentives: 0, platform_fee: 0 },
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function Earnings() {
  const { isOnline } = useSessionStore()
  const [period, setPeriod] = useState<Period>('today')
  const prefersReducedMotion = useReducedMotion()
  const [summary, setSummary] = useState<EarningsSummary>(EMPTY_SUMMARY)

  const [trips, setTrips] = useState<TripHistoryItem[]>([])
  const [tripsLoading, setTripsLoading] = useState(true)

  const [summaryError, setSummaryError] = useState(false)

  const loadSummary = () => {
    setSummaryError(false)
    driverRideApi.getEarningsSummary(period)
      .then(data => setSummary(data))
      .catch(() => { setSummary(EMPTY_SUMMARY); setSummaryError(true) })
  }

  useEffect(loadSummary, [period])

  useEffect(() => {
    driverRideApi.getMyTrips(1, 10)
      .then(data => setTrips(data.trips))
      .catch(() => {})
      .finally(() => setTripsLoading(false))
  }, [])

  const [payout, setPayout] = useState<DriverEarningsBalance | null>(null)
  const [payoutError, setPayoutError] = useState(false)
  const [cashingOut, setCashingOut] = useState(false)
  const [cashOutError, setCashOutError] = useState<string | null>(null)
  const [bankAccounts, setBankAccounts] = useState<DriverBankAccount[]>([])
  const [bankAccountsLoading, setBankAccountsLoading] = useState(true)
  const [bankAccountsError, setBankAccountsError] = useState(false)

  const loadBankAccounts = () => {
    setBankAccountsError(false)
    driverPayoutApi.listBankAccounts()
      .then(setBankAccounts)
      .catch(() => setBankAccountsError(true))
      .finally(() => setBankAccountsLoading(false))
  }

  const loadPayout = () => {
    setPayoutError(false)
    driverPayoutApi.getEarningsBalance().then(setPayout).catch(() => setPayoutError(true))
  }

  useEffect(() => {
    loadPayout()
    loadBankAccounts()
  }, [])

  const primaryAccount = bankAccounts.find(a => a.is_primary) ?? bankAccounts[0] ?? null
  const hasVerifiedAccount = bankAccounts.some(a => a.status === 'verified')

  async function handleCashOut() {
    setCashingOut(true)
    setCashOutError(null)
    try {
      await driverPayoutApi.instantCashOut()
      const updated = await driverPayoutApi.getEarningsBalance()
      setPayout(updated)
    } catch {
      setCashOutError('Cash out failed. Please try again.')
    } finally {
      setCashingOut(false)
    }
  }

  const e = summary
  const maxBar = Math.max(...e.chart, 1)

  return (
    <div className="min-h-screen bg-bg text-text-primary pb-24">
      <StatusBar isOnline={isOnline} earningsToday={e.total_earnings} />

      {/* Page header */}
      <div className="px-5 pt-[64px] pb-2">
        <h1 className="font-display font-bold text-2xl text-text-primary">Earnings</h1>
        <p className="text-text-muted text-sm mt-0.5">Your performance overview</p>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1 mx-5 bg-surface-2 rounded-2xl p-1.5 mb-5 border border-border">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'relative flex-1 py-2 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer',
              period === p.key
                ? 'text-primary'
                : 'text-text-muted hover:text-text-secondary'
            )}
            aria-pressed={period === p.key}
          >
            {period === p.key && (
              prefersReducedMotion
                ? <div className="absolute inset-0 rounded-xl bg-white" />
                : <motion.div
                    layoutId="period-pill"
                    className="absolute inset-0 rounded-xl bg-white"
                    style={{ boxShadow: '0 2px 16px rgba(10, 159, 176,0.07)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
            )}
            <span className="relative z-10">{p.label}</span>
          </button>
        ))}
      </div>

      {/* Total card */}
      <div className="card-glossy mx-5 rounded-3xl p-5 mb-4">
        <p className="text-text-muted text-[11px] font-semibold mb-1">
          {PERIODS.find(p => p.key === period)!.label}
        </p>
        <motion.div
          key={period}
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[44px] font-black text-text-primary leading-none tabular-nums">
            ₹{e.total_earnings.toLocaleString('en-IN')}
          </p>
        </motion.div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <span className="rounded-full px-3 py-1 text-xs font-semibold text-text-secondary bg-border-light border border-border">
            {e.trip_count} trips
          </span>
          <span className="rounded-full px-3 py-1 text-xs font-semibold text-text-secondary bg-border-light border border-border">
            {e.online_hours} online
          </span>
          <span className="rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1 text-text-secondary bg-border-light border border-border">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            {e.rating ?? '—'}
          </span>
        </div>
        {summaryError && (
          <p className="text-accent-red text-xs mt-3">
            Failed to load earnings.{' '}
            <button onClick={loadSummary} className="underline font-semibold cursor-pointer">Retry</button>
          </p>
        )}
      </div>

      {/* Payable balance + cash out */}
      {payoutError && (
        <div className="mx-5 bg-white rounded-3xl p-4 mb-4 border border-border text-center">
          <p className="text-accent-red text-xs">Failed to load payout balance.</p>
          <button onClick={loadPayout} className="text-primary text-xs font-semibold underline mt-1 cursor-pointer">Retry</button>
        </div>
      )}
      {payout && payout.payableBalance > 0 && (
        <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-text-muted text-[11px] font-semibold mb-1">Payable Balance</p>
              <p className="text-2xl font-black text-text-primary tabular-nums">
                ₹{payout.payableBalance.toLocaleString('en-IN')}
              </p>
            </div>
            {!payout.payoutsEnabled ? (
              <p className="text-text-muted text-xs text-right max-w-[140px]">
                Cash out is coming soon
              </p>
            ) : hasVerifiedAccount ? (
              <button
                onClick={() => void handleCashOut()}
                disabled={cashingOut}
                className="rounded-2xl px-4 py-3 text-sm font-bold text-white bg-primary disabled:opacity-50 cursor-pointer"
              >
                {cashingOut ? 'Processing…' : 'Cash Out Now'}
              </button>
            ) : (
              <p className="text-text-muted text-xs text-right max-w-[140px]">
                Add &amp; verify a bank account below to cash out
              </p>
            )}
          </div>
          {cashOutError && <p className="text-accent-red text-xs mt-2">{cashOutError}</p>}
        </div>
      )}

      {bankAccountsError && (
        <p className="mx-5 mb-4 text-accent-red text-xs text-center">
          Failed to load bank accounts.{' '}
          <button onClick={loadBankAccounts} className="underline font-semibold cursor-pointer">Retry</button>
        </p>
      )}
      <BankAccountSection account={primaryAccount} loading={bankAccountsLoading} onAdded={loadBankAccounts} />

      {/* Bar chart */}
      <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border">
        <p className="text-text-primary text-sm font-bold mb-4">Daily Earnings</p>
        <div className="flex items-end gap-2 h-28" role="img" aria-label="Earnings chart">
          {e.chart.map((val, i) => (
            <motion.div
              key={`${period}-${i}`}
              className="flex-1 flex flex-col items-center gap-1"
              initial={prefersReducedMotion ? false : { opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{ duration: 0.28, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: 'bottom' }}
            >
              <motion.div
                className="w-full rounded-t-md"
                animate={{ height: `${(val / maxBar) * 100}%` }}
                transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }}
                style={{
                  minHeight: 4,
                  background: val > 0
                    ? 'linear-gradient(180deg, #FB923C 0%, #F97316 100%)'
                    : '#F1F5F9',
                  borderRadius: '4px 4px 0 0',
                }}
              />
              <span className="text-text-muted text-[10px]">{e.chart_labels[i]}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Earnings breakdown */}
      <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border">
        <p className="text-text-primary text-sm font-bold mb-3">Breakdown</p>
        {[
          { label: 'Gross Fare',   value: e.breakdown.base_fare,    neg: false },
          { label: 'Tips',         value: e.breakdown.tips,        neg: false },
          { label: 'Incentives',   value: e.breakdown.incentives,  neg: false },
          { label: 'Platform Fee', value: e.breakdown.platform_fee, neg: true  },
        ].map(r => (
          <div key={r.label} className="flex justify-between items-center py-2.5 border-b border-border last:border-0">
            <span className="text-text-secondary text-sm">{r.label}</span>
            <span className={cn(
              'font-bold text-sm tabular-nums',
              r.neg ? 'text-accent-red' : 'text-accent-green'
            )}>
              {r.neg ? '-' : '+'}₹{r.value.toLocaleString('en-IN')}
            </span>
          </div>
        ))}
      </div>

      {/* Trip history */}
      <div className="mx-5 bg-white rounded-3xl p-5 border border-border">
        <p className="text-text-primary text-sm font-bold mb-3">Recent Trips</p>
        {tripsLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
              <div className="w-9 h-9 rounded-xl skeleton flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 skeleton rounded w-3/4" />
                <div className="h-3 skeleton rounded w-1/2" />
              </div>
              <div className="h-4 w-12 skeleton rounded" />
            </div>
          ))
        ) : trips.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-4">No trips yet</p>
        ) : (
          trips.map(t => (
            <div key={t.id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-surface-2 border border-border"
              >
                <Car size={15} className="text-primary" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-semibold truncate">
                  {t.origin_address ?? '—'} → {t.destination_address ?? '—'}
                </p>
                <p className="text-text-muted text-xs mt-0.5">
                  {fmtDate(t.requested_at)}
                  {t.user_name ? ` · ${t.user_name}` : ''}
                </p>
              </div>
              <p className="text-accent-green font-bold text-sm flex-shrink-0 tabular-nums">
                {t.driver_earning ? `₹${parseFloat(t.driver_earning).toLocaleString('en-IN')}` : '—'}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
