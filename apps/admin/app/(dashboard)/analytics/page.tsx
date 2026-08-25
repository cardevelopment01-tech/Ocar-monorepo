'use client'
import { useState, useEffect, useCallback } from 'react'
import { Star } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  adminAnalyticsApi,
  type AnalyticsSummary,
  type DailyRevenue,
  type DriverOnboardingFunnel,
  type DriverAvailability,
} from '@/lib/admin-api'
import { COLORS } from '@/lib/colors'

type Period = '7d' | '30d' | '90d'
const PERIODS: { key: Period; label: string }[] = [
  { key: '7d',  label: '7 days'  },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
]

const EMPTY: AnalyticsSummary = {
  period_days: 30,
  daily_revenue: [],
  funnel: { requested: 0, accepted: 0, completed: 0, cancelled: 0 },
  top_drivers: [],
  city_breakdown: [],
  category_breakdown: [],
}

// ── Revenue area chart ────────────────────────────────────────────────────────
function RevenueChart({ data }: { data: DailyRevenue[] }) {
  if (!data.length) return (
    <div className="h-36 flex items-center justify-center text-sm text-text-muted">
      No revenue data for this period
    </div>
  )

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={COLORS.primary} stopOpacity={0.18} />
            <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: COLORS.textMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: COLORS.textMuted }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          formatter={(value) => [`₹${new Intl.NumberFormat('en-IN').format(Math.round(Number(value)))}`, 'Revenue']}
          contentStyle={{ borderRadius: 8, borderColor: COLORS.border, fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={COLORS.primary}
          strokeWidth={2}
          fill="url(#revFill)"
          dot={{ r: 3, fill: COLORS.primary, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Horizontal bar breakdown ──────────────────────────────────────────────────
function HBarChart({ items }: {
  items: { label: string; value: number; subLabel?: string; color?: string }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(items.length * 40, 80)}>
      <BarChart
        data={items}
        layout="vertical"
        margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
        barSize={14}
      >
        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: COLORS.textMuted }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 12, fill: COLORS.textSecondary }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip
          formatter={(value, _name, item) => [item.payload.subLabel ?? Number(value).toLocaleString('en-IN'), '']}
          contentStyle={{ borderRadius: 8, borderColor: COLORS.border, fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {items.map((item, i) => (
            <Cell key={i} fill={item.color ?? COLORS.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function availabilityColor(pct: number): string {
  if (pct < 30) return COLORS.danger
  if (pct < 50) return COLORS.warning
  return COLORS.success
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData]     = useState<AnalyticsSummary>(EMPTY)
  const [loading, setLoading] = useState(true)

  const [onboarding, setOnboarding]         = useState<DriverOnboardingFunnel[]>([])
  const [onboardingLoading, setOnboardingLoading] = useState(true)
  const [availability, setAvailability]     = useState<DriverAvailability[]>([])
  const [availabilityLoading, setAvailabilityLoading] = useState(true)

  const load = useCallback(async (p: Period) => {
    setLoading(true)
    try {
      const res = await adminAnalyticsApi.getSummary(p)
      setData(res)
    } catch {
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOnboarding = useCallback(async (p: Period) => {
    setOnboardingLoading(true)
    try {
      setOnboarding(await adminAnalyticsApi.getDriverOnboarding(p))
    } catch {
      setOnboarding([])
    } finally {
      setOnboardingLoading(false)
    }
  }, [])

  const loadAvailability = useCallback(async () => {
    setAvailabilityLoading(true)
    try {
      setAvailability(await adminAnalyticsApi.getDriverAvailability())
    } catch {
      setAvailability([])
    } finally {
      setAvailabilityLoading(false)
    }
  }, [])

  useEffect(() => { void load(period) }, [period, load])
  useEffect(() => { void loadOnboarding(period) }, [period, loadOnboarding])
  // Availability is a live snapshot, not period-scoped — poll instead of
  // reacting to the period selector.
  useEffect(() => {
    void loadAvailability()
    const id = setInterval(() => { void loadAvailability() }, 60_000)
    return () => clearInterval(id)
  }, [loadAvailability])

  const { funnel, top_drivers, city_breakdown, category_breakdown, daily_revenue } = data

  const totalRevenue = daily_revenue.reduce((s, d) => s + d.revenue, 0)

  return (
    <div className="space-y-5">

      {/* ── Header + period selector ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Reports</h1>
          <p className="text-xs text-text-muted mt-0.5">Operations and revenue analytics</p>
        </div>
        <div className="flex gap-1 bg-surface-2 rounded-xl p-1 border border-border">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                period === p.key
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Revenue chart ── */}
      <div className="admin-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-text-muted font-semibold mb-0.5">Total Revenue</p>
            {loading
              ? <div className="skeleton h-8 w-32 rounded" />
              : <p className="text-3xl font-black text-text-primary tabular-nums">
                  ₹{new Intl.NumberFormat('en-IN').format(Math.round(totalRevenue))}
                </p>
            }
          </div>
          <span className="text-xs text-text-muted">{period} window</span>
        </div>
        {loading
          ? <div className="skeleton rounded h-36 w-full" />
          : <RevenueChart data={daily_revenue} />
        }
      </div>

      {/* ── Funnel + breakdowns ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Ride funnel */}
        <div className="admin-card">
          <h2 className="text-sm font-bold text-text-primary mb-4">Ride Funnel</h2>
          {loading ? (
            <div className="space-y-4">
              {[1,2,3,4].map(i => <div key={i} className="skeleton h-8 rounded" />)}
            </div>
          ) : (
            <HBarChart items={[
              { label: 'Requested', value: funnel.requested, color: COLORS.textMuted },
              {
                label: 'Accepted',
                value: funnel.accepted,
                subLabel: `${funnel.accepted.toLocaleString('en-IN')} (${funnel.requested > 0 ? Math.round(funnel.accepted / funnel.requested * 100) : 0}%)`,
                color: COLORS.primary,
              },
              {
                label: 'Completed',
                value: funnel.completed,
                subLabel: `${funnel.completed.toLocaleString('en-IN')} (${funnel.requested > 0 ? Math.round(funnel.completed / funnel.requested * 100) : 0}%)`,
                color: COLORS.success,
              },
              {
                label: 'Cancelled',
                value: funnel.cancelled,
                subLabel: `${funnel.cancelled.toLocaleString('en-IN')} (${funnel.requested > 0 ? Math.round(funnel.cancelled / funnel.requested * 100) : 0}%)`,
                color: COLORS.danger,
              },
            ]} />
          )}
        </div>

        {/* City breakdown */}
        <div className="admin-card">
          <h2 className="text-sm font-bold text-text-primary mb-4">By City</h2>
          {loading ? (
            <div className="space-y-4">
              {[1,2,3].map(i => <div key={i} className="skeleton h-8 rounded" />)}
            </div>
          ) : city_breakdown.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">No data</p>
          ) : (
            <HBarChart items={city_breakdown.map(c => ({
              label: c.city_name,
              value: c.ride_count,
              subLabel: `${c.ride_count} rides · ₹${new Intl.NumberFormat('en-IN').format(Math.round(c.revenue))}`,
              color: COLORS.primary,
            }))} />
          )}
        </div>

        {/* Category breakdown */}
        <div className="admin-card">
          <h2 className="text-sm font-bold text-text-primary mb-4">By Category</h2>
          {loading ? (
            <div className="space-y-4">
              {[1,2,3].map(i => <div key={i} className="skeleton h-8 rounded" />)}
            </div>
          ) : category_breakdown.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">No data</p>
          ) : (
            <HBarChart items={category_breakdown.map((c, i) => {
              const colors = [COLORS.primary, COLORS.success, COLORS.warning, COLORS.danger, COLORS.purple]
              return {
                label: c.category_name,
                value: c.ride_count,
                subLabel: `${c.ride_count} rides`,
                color: colors[i % colors.length],
              }
            })} />
          )}
        </div>
      </div>

      {/* ── Driver onboarding & availability ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Onboarding funnel by city */}
        <div className="admin-card">
          <h2 className="text-sm font-bold text-text-primary mb-1">Driver Onboarding by City</h2>
          <p className="text-xs text-text-muted mb-4">Signups this period, sorted by volume — low conversion % flags where onboarding is stalling</p>
          {onboardingLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="skeleton h-8 rounded" />)}
            </div>
          ) : onboarding.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">No signups in this period</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>City</th>
                  <th>Signed up</th>
                  <th>Docs in</th>
                  <th>Activated</th>
                  <th>Conversion</th>
                  <th>Avg. hrs to active</th>
                </tr>
              </thead>
              <tbody>
                {onboarding.map(row => (
                  <tr key={row.city_name}>
                    <td className="font-semibold text-text-primary">{row.city_name}</td>
                    <td>{row.signed_up}</td>
                    <td>{row.docs_submitted}</td>
                    <td>{row.activated}</td>
                    <td style={{ color: availabilityColor(row.conversion_pct) }} className="font-semibold">
                      {row.conversion_pct.toFixed(0)}%
                    </td>
                    <td className="text-text-muted">
                      {row.avg_hours_to_active == null ? '—' : `${row.avg_hours_to_active.toFixed(0)}h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Live availability by city */}
        <div className="admin-card">
          <h2 className="text-sm font-bold text-text-primary mb-1">Driver Availability by City</h2>
          <p className="text-xs text-text-muted mb-4">Live snapshot — active drivers who are actually online and on the road right now</p>
          {availabilityLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="skeleton h-8 rounded" />)}
            </div>
          ) : availability.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">No active drivers</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>City</th>
                  <th>Active</th>
                  <th>Online now</th>
                  <th>Available now</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {availability.map(row => (
                  <tr key={row.city_name}>
                    <td className="font-semibold text-text-primary">{row.city_name}</td>
                    <td>{row.total_active}</td>
                    <td>{row.online_now}</td>
                    <td>{row.available_now}</td>
                    <td style={{ color: availabilityColor(row.availability_pct) }} className="font-semibold">
                      {row.availability_pct.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Top drivers table ── */}
      <div className="admin-card">
        <h2 className="text-sm font-bold text-text-primary mb-4">Top Drivers</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Driver</th>
              <th>Trips</th>
              <th>Earnings</th>
              <th>Rating</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {[1,2,3,4,5].map(j => (
                      <td key={j}><div className="skeleton h-4 rounded w-full" /></td>
                    ))}
                  </tr>
                ))
              : top_drivers.length === 0
                ? (
                  <tr>
                    <td colSpan={5} className="text-center text-text-muted py-6 text-sm">
                      No completed trips in this period
                    </td>
                  </tr>
                )
                : top_drivers.map((d, i) => (
                  <tr key={d.driver_id} className="group">
                    <td className="text-text-muted font-bold">{i + 1}</td>
                    <td>
                      <p className="font-semibold text-text-primary">{d.driver_name ?? '—'}</p>
                      <p className="text-text-muted text-xs">{d.driver_code}</p>
                    </td>
                    <td className="font-semibold text-text-primary">{d.trip_count.toLocaleString('en-IN')}</td>
                    <td className="font-bold text-text-primary">
                      ₹{new Intl.NumberFormat('en-IN').format(Math.round(d.total_earnings))}
                    </td>
                    <td>
                      {d.rating_avg != null ? (
                        <span className="flex items-center gap-1">
                          <Star size={12} className="text-accent-amber fill-accent-amber" />
                          <span className="text-text-primary font-semibold">{parseFloat(d.rating_avg).toFixed(1)}</span>
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
