'use client'
import { Car, Users, IndianRupee, AlertTriangle } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import { mockStats, mockRides } from '@/lib/mock-data'

const s = mockStats.dashboard

const SECONDARY_ICONS = {
  'Completed Rides':    { color: '#10B981', bg: '#D1FAE5' },
  'Cancelled Rides':    { color: '#EF4444', bg: '#FEE2E2' },
  'New Driver Signups': { color: '#4F46E5', bg: '#EEF2FF' },
}

export default function OverviewPage() {
  return (
    <div className="space-y-5">

      {/* ── Primary stat cards ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Rides Today"     value={s.totalRidesToday} change="+12% from yesterday" changeType="up"      icon={Car}           gradient="blue"   />
        <StatCard title="Active Drivers Online" value={s.activeDrivers}   change="+5 from last hour"  changeType="up"      icon={Users}         gradient="green"  />
        <StatCard title="Revenue Today"         value={`₹${new Intl.NumberFormat('en-IN').format(s.revenueToday)}`} change="+8% from yesterday" changeType="up" icon={IndianRupee} gradient="amber"  />
        <StatCard title="Open Disputes"         value={s.openDisputes}    change="2 high priority"    changeType="neutral" icon={AlertTriangle}  gradient="purple" />
      </div>

      {/* ── Secondary stat row ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Completed Rides',    value: s.completedRides, pill: 'completed' },
          { label: 'Cancelled Rides',    value: s.cancelledRides, pill: 'cancelled' },
          { label: 'New Driver Signups', value: s.newDrivers,     pill: 'active' },
        ].map(c => {
          const style = SECONDARY_ICONS[c.label as keyof typeof SECONDARY_ICONS]
          return (
            <div key={c.label} className="admin-card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: style.bg }}
                >
                  <span
                    className="text-lg font-black"
                    style={{ color: style.color }}
                  >
                    {String(c.value.toLocaleString('en-IN')).slice(0,1)}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-0.5">{c.label}</p>
                  <p className="text-2xl font-bold text-text-primary">{c.value.toLocaleString('en-IN')}</p>
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
              {mockRides.map(ride => (
                <tr key={ride.id} className="group">
                  <td className="text-text-muted">{ride.time}</td>
                  <td className="font-semibold text-text-primary">{ride.user.name}</td>
                  <td>{ride.driver?.name ?? <span className="text-text-muted italic">Unassigned</span>}</td>
                  <td>
                    <span className="text-text-primary">{ride.from}</span>
                    <span className="text-text-muted mx-1">→</span>
                    <span className="text-text-primary">{ride.to}</span>
                  </td>
                  <td className="font-bold text-text-primary">₹{ride.fare.toLocaleString('en-IN')}</td>
                  <td><StatusPill status={ride.status} /></td>
                </tr>
              ))}
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
                <p className="text-2xl font-black text-emerald-700">{s.activeDrivers}</p>
                <p className="text-xs text-emerald-600/80 mt-0.5 font-medium">Drivers Online</p>
              </div>
              <div
                className="rounded-xl p-3.5 text-center"
                style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #DDD6FE 100%)' }}
              >
                <p className="text-2xl font-black text-indigo-700">{s.activeTrips}</p>
                <p className="text-xs text-indigo-500/80 mt-0.5 font-medium">Active Trips</p>
              </div>
            </div>

            {/* Bar chart */}
            <p className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2">Rides / Last 12h</p>
            <div className="flex items-end gap-1 h-14">
              {s.ridesLastHour.map((v, i) => {
                const max = Math.max(...s.ridesLastHour)
                const isLast = i === s.ridesLastHour.length - 1
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{
                      height: `${(v / max) * 100}%`,
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
          <div
            className="admin-card"
            style={{ borderLeft: `3px solid ${mockStats.dashboard.openDisputes > 0 ? '#EF4444' : '#10B981'}` }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-md font-bold text-text-primary">SOS Alerts</h2>
              {mockStats.dashboard.openDisputes > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-danger-light text-danger">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                  Active
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-danger">1 Active Alert</p>
            <p className="text-xs text-text-muted mt-1">Ramesh Kumar — MG Road → Airport</p>
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
