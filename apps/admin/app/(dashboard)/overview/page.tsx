'use client'
import { Car, Users, IndianRupee, AlertTriangle, CheckCircle, XCircle, UserPlus } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import { mockStats, mockRides } from '@/lib/mock-data'

const s = mockStats.dashboard

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      {/* Primary stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Rides Today"     value={s.totalRidesToday} change="+12% from yesterday" changeType="up"      icon={Car}          gradient="blue"   />
        <StatCard title="Active Drivers Online" value={s.activeDrivers}   change="+5 from last hour"  changeType="up"      icon={Users}        gradient="green"  />
        <StatCard title="Revenue Today"         value={`₹${new Intl.NumberFormat('en-IN').format(s.revenueToday)}`} change="+8% from yesterday" changeType="up" icon={IndianRupee} gradient="amber"  />
        <StatCard title="Open Disputes"         value={s.openDisputes}    change="2 high priority"    changeType="neutral" icon={AlertTriangle} gradient="purple" />
      </div>

      {/* Secondary stat row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Completed Rides',    value: s.completedRides,  pill: 'completed' },
          { label: 'Cancelled Rides',    value: s.cancelledRides,  pill: 'cancelled' },
          { label: 'New Driver Signups', value: s.newDrivers,      pill: 'active' },
        ].map(c => (
          <div key={c.label} className="admin-card flex items-center justify-between">
            <div>
              <p className="text-text-muted text-xs mb-1">{c.label}</p>
              <p className="text-2xl font-bold text-text-primary">{c.value.toLocaleString('en-IN')}</p>
            </div>
            <StatusPill status={c.pill} />
          </div>
        ))}
      </div>

      {/* Main two-column */}
      <div className="grid grid-cols-5 gap-4">
        {/* Recent Rides — 3 cols */}
        <div className="col-span-3 admin-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-md font-bold text-text-primary">Recent Rides</h2>
              <p className="text-xs text-text-muted">Auto-refreshes every 30s</p>
            </div>
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
                  <td className="font-medium text-text-primary">{ride.user.name}</td>
                  <td>{ride.driver?.name ?? <span className="text-text-muted italic">Unassigned</span>}</td>
                  <td>
                    <span className="text-text-primary">{ride.from}</span>
                    <span className="text-text-muted mx-1">→</span>
                    <span className="text-text-primary">{ride.to}</span>
                  </td>
                  <td className="font-semibold text-text-primary">₹{ride.fare.toLocaleString('en-IN')}</td>
                  <td><StatusPill status={ride.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pt-3 border-t border-border-light mt-2">
            <a href="/rides" className="text-xs text-primary font-semibold hover:underline">View all rides →</a>
          </div>
        </div>

        {/* Right column — 2 cols */}
        <div className="col-span-2 space-y-4">
          {/* Live Stats */}
          <div className="admin-card">
            <h2 className="text-md font-bold text-text-primary mb-4">Live Stats</h2>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-success-light rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-success">{s.activeDrivers}</p>
                <p className="text-xs text-success/70 mt-0.5">Drivers Online</p>
              </div>
              <div className="bg-info-light rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-info">{s.activeTrips}</p>
                <p className="text-xs text-info/70 mt-0.5">Active Trips</p>
              </div>
            </div>
            {/* Hourly bar chart */}
            <p className="text-xs text-text-muted mb-2 font-semibold uppercase tracking-wide">Rides / Last 12h</p>
            <div className="flex items-end gap-1 h-14">
              {s.ridesLastHour.map((v, i) => {
                const max = Math.max(...s.ridesLastHour)
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm bg-primary transition-all"
                    style={{ height: `${(v / max) * 100}%`, opacity: i === s.ridesLastHour.length - 1 ? 1 : 0.5 }}
                  />
                )
              })}
            </div>
          </div>

          {/* SOS Alerts */}
          <div className={`admin-card border-l-4 ${mockStats.dashboard.openDisputes > 0 ? 'border-l-danger' : 'border-l-success'}`}>
            <h2 className="text-md font-bold text-text-primary mb-3">SOS Alerts</h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
              <p className="text-sm font-semibold text-danger">1 Active Alert</p>
            </div>
            <p className="text-xs text-text-muted mt-1">Ramesh Kumar — MG Road → Airport</p>
            <a href="/sos" className="text-xs text-primary font-semibold hover:underline mt-3 inline-block">
              View SOS page →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
