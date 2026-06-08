'use client'
import { Shield, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import { mockSOS } from '@/lib/mock-data'

const activeSOS = mockSOS.filter(s => s.status === 'active')

export default function SOSPage() {
  return (
    <div className="space-y-5">
      {/* Active SOS banner */}
      {activeSOS.length > 0 && (
        <div
          className="rounded-2xl px-5 py-4 border-2 border-danger flex items-center gap-4"
          style={{ background: 'rgba(239,68,68,0.08)', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }}
        >
          <span className="text-2xl">🚨</span>
          <div className="flex-1">
            <p className="font-black text-danger text-lg">ACTIVE SOS</p>
            <p className="text-sm text-danger/80">{activeSOS[0].driver.name} · {activeSOS[0].route}</p>
          </div>
          <span className="text-danger font-bold text-sm">{activeSOS[0].elapsed}</span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Active Now"      value={activeSOS.length}              change="Immediate action" changeType={activeSOS.length > 0 ? 'down' : 'neutral'} icon={Shield}        gradient="pink"   />
        <StatCard title="Resolved Today"  value={3}                             change="+1 from yesterday" changeType="up"    icon={CheckCircle}   gradient="green"  />
        <StatCard title="False Alarms"    value={1}                             change="This week"         changeType="neutral" icon={AlertTriangle} gradient="amber"  />
        <StatCard title="Avg Response"    value="2.4 min"                       change="-0.8 min"          changeType="up"    icon={Clock}         gradient="blue"   />
      </div>

      {/* Active SOS cards */}
      {activeSOS.length > 0 && (
        <div>
          <h2 className="text-md font-bold text-text-primary mb-3">Active Alerts</h2>
          <div className="space-y-3">
            {activeSOS.map(sos => (
              <div
                key={sos.id}
                className="bg-surface rounded-2xl border-l-4 border-l-danger p-5 shadow-card"
                style={{ background: 'rgba(239,68,68,0.04)' }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                      <p className="font-bold text-text-primary text-lg">{sos.driver.name}</p>
                      <span className="font-mono text-xs text-text-muted">{sos.driver.code}</span>
                    </div>
                    <p className="text-sm text-text-secondary">{sos.route}</p>
                    <p className="text-xs text-text-muted mt-1">📍 {sos.location}</p>
                    <p className="text-xs text-danger font-semibold mt-2">Elapsed: {sos.elapsed}</p>
                  </div>
                  <span className="pill pill-danger">{sos.severity} severity</span>
                </div>
                <div className="flex gap-2 mt-4">
                  <button className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors">Acknowledge</button>
                  <button className="px-4 py-2 text-sm font-semibold border border-border rounded-xl hover:bg-surface-2 transition-colors text-text-secondary">Assign to Me</button>
                  <button className="px-4 py-2 text-sm font-semibold bg-success text-white rounded-xl hover:bg-emerald-600 transition-colors">Mark Resolved</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historical */}
      <div className="admin-card">
        <h2 className="text-md font-bold text-text-primary mb-4">Historical SOS Events</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th><th>Driver</th><th>Route</th><th>Severity</th><th>Status</th><th>Time</th>
            </tr>
          </thead>
          <tbody>
            {mockSOS.map(sos => (
              <tr key={sos.id} className="group">
                <td className="font-mono text-xs text-primary">{sos.id}</td>
                <td className="font-semibold text-text-primary">{sos.driver.name}</td>
                <td className="text-text-secondary">{sos.route}</td>
                <td><span className={`pill ${sos.severity === 'high' ? 'pill-danger' : 'pill-warning'}`}>{sos.severity}</span></td>
                <td><span className={`pill ${sos.status === 'active' ? 'pill-danger' : 'pill-success'}`}>{sos.status}</span></td>
                <td className="text-text-muted">{sos.elapsed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
