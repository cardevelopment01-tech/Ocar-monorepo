import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import StatusBar from '@/components/ui/StatusBar'
import { useSessionStore } from '@/store/useSessionStore'
import { mockEarnings, mockTripHistory } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Period = 'today' | 'week' | 'month'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
]

export default function Earnings() {
  const navigate = useNavigate()
  const { isOnline } = useSessionStore()
  const [period, setPeriod] = useState<Period>('today')
  const e = mockEarnings[period]
  const maxBar = Math.max(...e.chart, 1)

  return (
    <div className="min-h-screen bg-bg text-text-primary pb-10">
      <StatusBar isOnline={isOnline} earningsToday={mockEarnings.today.total} />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-16 pb-4">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <h1 className="text-xl font-bold">Earnings</h1>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1 mx-4 bg-surface rounded-2xl p-1.5 mb-5 border border-border">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'flex-1 py-2 rounded-xl text-sm font-bold transition-all',
              period === p.key ? 'bg-primary text-text-inverse shadow-button' : 'text-text-muted'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Total card */}
      <div
        className="mx-4 bg-surface rounded-3xl p-5 mb-4 border border-border"
        style={{ borderTopColor: '#22C55E', borderTopWidth: 3 }}
      >
        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1">
          {PERIODS.find(p => p.key === period)!.label}
        </p>
        <p className="text-[44px] font-black text-text-primary leading-none">
          ₹{e.total.toLocaleString('en-IN')}
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          <span className="bg-surface-3 rounded-full px-3 py-1 text-xs font-semibold text-text-secondary">
            {e.trips} trips
          </span>
          <span className="bg-surface-3 rounded-full px-3 py-1 text-xs font-semibold text-text-secondary">
            {e.hours} online
          </span>
          <span className="bg-surface-3 rounded-full px-3 py-1 text-xs font-semibold text-primary">
            ⭐ {e.rating}
          </span>
        </div>
      </div>

      {/* Bar chart */}
      <div className="mx-4 bg-surface rounded-3xl p-5 mb-4 border border-border">
        <p className="text-text-secondary text-sm font-semibold mb-4">Breakdown</p>
        <div className="flex items-end gap-2 h-28">
          {e.chart.map((val, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-t-md transition-all duration-500"
                style={{
                  height: `${(val / maxBar) * 100}%`,
                  minHeight: 4,
                  background: val > 0 ? '#22C55E' : '#1E2433',
                }}
              />
              <span className="text-text-muted text-[10px]">{e.chartLabels[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Earnings breakdown */}
      <div className="mx-4 bg-surface rounded-3xl p-5 mb-4 border border-border">
        <p className="text-text-secondary text-sm font-semibold mb-3">Earnings Breakdown</p>
        {[
          { label: 'Base Fare',    value: e.breakdown.baseFare,    neg: false },
          { label: 'Tips',         value: e.breakdown.tips,        neg: false },
          { label: 'Incentives',   value: e.breakdown.incentives,  neg: false },
          { label: 'Platform Fee', value: e.breakdown.platformFee, neg: true  },
        ].map(r => (
          <div key={r.label} className="flex justify-between items-center py-2.5 border-b border-border last:border-0">
            <span className="text-text-secondary text-sm">{r.label}</span>
            <span className={cn('font-bold text-sm', r.neg ? 'text-accent-red' : 'text-text-primary')}>
              {r.neg ? '-' : '+'}₹{r.value.toLocaleString('en-IN')}
            </span>
          </div>
        ))}
      </div>

      {/* Trip history */}
      <div className="mx-4 bg-surface rounded-3xl p-5 border border-border">
        <p className="text-text-secondary text-sm font-semibold mb-3">Recent Trips</p>
        {mockTripHistory.map(t => (
          <div key={t.id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
            <div className="w-9 h-9 rounded-xl bg-surface-3 flex items-center justify-center flex-shrink-0">
              <span className="text-base">🚗</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-sm font-semibold truncate">
                {t.from} → {t.to}
              </p>
              <p className="text-text-muted text-xs mt-0.5">{t.time} · {t.distance} km</p>
            </div>
            <p className="text-primary font-bold text-sm flex-shrink-0">₹{t.fare}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
