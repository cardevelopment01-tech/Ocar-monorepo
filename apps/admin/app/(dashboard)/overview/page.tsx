'use client'
import { useState, useEffect, useCallback } from 'react'
import { Car, Users, IndianRupee, AlertTriangle } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import { adminStatsApi, adminRideApi, type AdminDashboardStats, type AdminRideItem } from '@/lib/admin-api'
import { safetyApi, type SosAlert } from '@/lib/safety-api'

const EMPTY_STATS: AdminDashboardStats = {
  total_rides_today: 0, active_drivers_online: 0, revenue_today: 0, open_disputes: 0,
  completed_rides: 0, cancelled_rides: 0, new_driver_signups: 0, active_trips: 0,
  rides_last_12h: Array(12).fill(0),
}

const SECONDARY_ICONS = {
  'Completed Rides':    { color: '#10B981', bg: '#D1FAE5' },
  'Cancelled Rides':    { color: '#EF4444', bg: '#FEE2E2' },
  'New Driver Signups': { color: '#4F46E5', bg: '#EEF2FF' },
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function SkeletonCell() {
  return <div className="skeleton h-4 rounded w-full" />
}

export default function OverviewPage() {
  const [stats, setStats] = useState<AdminDashboardStats>(EMPTY_STATS)
  const [rides, setRides] = useState<AdminRideItem[]>([])
  const [sosAlerts, setSosAlerts] = useState<SosAlert[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const [statsRes, ridesRes, sosRes] = await Promise.allSettled([
      adminStatsApi.get(),
      adminRideApi.list({ limit: 8 }),
      safetyApi.getSosAlerts({ limit: 5 }),
    ])
    if (statsRes.status === 'fulfilled') setStats(statsRes.value)
    if (ridesRes.status === 'fulfilled') setRides(ridesRes.value.rides)
    if (sosRes.status === 'fulfilled') {
      setSosAlerts(
        sosRes.value.alerts.filter(a =>
          ['triggered', 'acknowledged', 'responding'].includes(a.status)
        )
      )
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchAll()
    const interval = setInterval(() => { void fetchAll() }, 30_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const s = stats
  const maxBar = Math.max(...s.rides_last_12h, 1)

  return (
    <div className="space-y-5">

      {/* ── Primary stat cards ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Total Rides Today"
          value={loading ? '—' : s.total_rides_today}
          change="+12% from yesterday"
          changeType="up"
          icon={Car}
          gradient="blue"
        />
        <StatCard
          title="Active Drivers Online"
          value={loading ? '—' : s.active_drivers_online}
          change="Live count"
          changeType="up"
          icon={Users}
          gradient="green"
        />
        <StatCard
          title="Revenue Today"
          value={loading ? '—' : `₹${new Intl.NumberFormat('en-IN').format(Math.round(s.revenue_today))}`}
          change="Captured payments"
          changeType="up"
          icon={IndianRupee}
          gradient="amber"
        />
        <StatCard
          title="Open Disputes"
          value={loading ? '—' : s.open_disputes}
          change={s.open_disputes > 0 ? `${s.open_disputes} need attention` : 'All clear'}
          changeType="neutral"
          icon={AlertTriangle}
          gradient="purple"
        />
      </div>

      {/* ── Secondary stat row ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Completed Rides',    value: s.completed_rides,    pill: 'completed' },
          { label: 'Cancelled Rides',    value: s.cancelled_rides,    pill: 'cancelled' },
          { label: 'New Driver Signups', value: s.new_driver_signups, pill: 'active'    },
        ].map(c => {
          const style = SECONDARY_ICONS[c.label as keyof typeof SECONDARY_ICONS]
          return (
            <div key={c.label} className="admin-card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: style.bg }}
                >
                  <span className="text-lg font-black" style={{ color: style.color }}>
                    {loading ? '—' : String(c.value.toLocaleString('en-IN')).slice(0, 1)}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-0.5">{c.label}</p>
                  {loading
                    ? <div className="skeleton h-6 w-12 rounded mt-0.5" />
                    : <p className="text-2xl font-bold text-text-primary">{c.value.toLocaleString('en-IN')}</p>
                  }
                </div>
              </div>
              <StatusPill status={c.pill} />
            </div>
          )
        })}
      </div>

      {/* ── Main two-column ── */}
      <div className="grid grid-cols-5 gap-4">

        {/* Recent Rides — 3 cols */}
        <div className="col-span-3 admin-card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-md font-bold text-text-primary">Recent Rides</h2>
              <p className="text-xs text-text-muted mt-0.5">Auto-refreshes every 30s</p>
            </div>
            <a
              href="/rides"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              style={{ color: '#4F46E5', background: '#EEF2FF' }}
            >
              View all →
            </a>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Driver</th>
                <th>Route</th>
                <th>Fare</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j}><SkeletonCell /></td>
                      ))}
                    </tr>
                  ))
                : rides.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="text-center text-text-muted py-6 text-sm">No rides yet today</td>
                    </tr>
                  )
                  : rides.map(ride => (
                    <tr key={ride.id} className="group">
                      <td className="text-text-muted">{fmtTime(ride.requested_at)}</td>
                      <td className="font-semibold text-text-primary">{ride.user_name}</td>
                      <td>{ride.driver_name ?? <span className="text-text-muted italic">Unassigned</span>}</td>
                      <td>
                        <span className="text-text-primary">{ride.origin_address ?? '—'}</span>
                        <span className="text-text-muted mx-1">→</span>
                        <span className="text-text-primary">{ride.destination_address ?? '—'}</span>
                      </td>
                      <td className="font-bold text-text-primary">
                        {ride.fare ? `₹${parseFloat(ride.fare).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td><StatusPill status={ride.status} /></td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {/* Right column — 2 cols */}
        <div className="col-span-2 space-y-4">

          {/* Live Stats */}
          <div className="admin-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-md font-bold text-text-primary">Live Stats</h2>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                Live
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div
                className="rounded-xl p-3.5 text-center"
                style={{ background: 'linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)' }}
              >
                <p className="text-2xl font-black text-emerald-700">
                  {loading ? '—' : s.active_drivers_online}
                </p>
                <p className="text-xs text-emerald-600/80 mt-0.5 font-medium">Drivers Online</p>
              </div>
              <div
                className="rounded-xl p-3.5 text-center"
                style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #DDD6FE 100%)' }}
              >
                <p className="text-2xl font-black text-indigo-700">
                  {loading ? '—' : s.active_trips}
                </p>
                <p className="text-xs text-indigo-500/80 mt-0.5 font-medium">Active Trips</p>
              </div>
            </div>

            {/* Bar chart */}
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2">Rides / Last 12h</p>
            <div className="flex items-end gap-1 h-14">
              {s.rides_last_12h.map((v, i) => {
                const isLast = i === s.rides_last_12h.length - 1
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{
                      height: `${(v / maxBar) * 100}%`,
                      minHeight: 4,
                      background: isLast
                        ? 'linear-gradient(180deg, #4F46E5 0%, #7C3AED 100%)'
                        : '#EEF2FF',
                    }}
                  />
                )
              })}
            </div>
          </div>

          {/* SOS Alerts */}
          <div className="admin-card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-md font-bold text-text-primary">SOS Alerts</h2>
              {sosAlerts.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-danger-light text-danger">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                  Active
                </span>
              )}
            </div>
            {loading
              ? <div className="skeleton h-4 rounded w-3/4" />
              : sosAlerts.length === 0
                ? <p className="text-sm font-semibold text-success">All clear</p>
                : (
                  <>
                    <p className="text-sm font-semibold text-danger">
                      {sosAlerts.length} Active Alert{sosAlerts.length > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-text-muted mt-1 truncate">
                      {sosAlerts[0]?.user_name ?? sosAlerts[0]?.driver_name ?? 'Unknown'}
                      {sosAlerts[0]?.origin_address ? ` — ${sosAlerts[0].origin_address}` : ''}
                    </p>
                  </>
                )
            }
            <a
              href="/sos"
              className="inline-block mt-3 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              style={{ color: '#EF4444', background: '#FEE2E2' }}
            >
              View SOS page →
            </a>
          </div>

        </div>
      </div>
    </div>
  )
}
