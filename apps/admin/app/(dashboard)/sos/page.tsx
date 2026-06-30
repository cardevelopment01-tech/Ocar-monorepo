'use client'
import { useState, useEffect, useCallback } from 'react'
import { Shield, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { safetyApi, type SosAlert } from '@/lib/safety-api'

const ACTIVE_STATUSES = new Set(['triggered', 'acknowledged', 'responding'])

function severityClass(s: string) {
  if (s === 'high')   return 'pill-danger'
  if (s === 'medium') return 'pill-warning'
  return 'pill-info'
}

function statusClass(s: string) {
  if (ACTIVE_STATUSES.has(s)) return 'pill-danger'
  if (s === 'resolved')       return 'pill-success'
  return 'pill-info'
}

function elapsed(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const m  = Math.floor(ms / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)}h ago`
}

export default function SOSPage() {
  const [alerts,         setAlerts]         = useState<SosAlert[]>([])
  const [loading,        setLoading]        = useState(true)
  const [actingId,       setActingId]       = useState<string | null>(null)
  const [confirmAction,  setConfirmAction]  = useState<{ id: string; status: 'resolved' | 'false_alarm' } | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await safetyApi.getSosAlerts({ limit: 50 })
      setAlerts(data.alerts)
    } catch {
      // ignore — show empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const active    = alerts.filter(a => ACTIVE_STATUSES.has(a.status))
  const resolved  = alerts.filter(a => a.status === 'resolved').length
  const falseAlarm = alerts.filter(a => a.status === 'false_alarm').length

  async function acknowledge(id: string) {
    setActingId(id)
    try {
      const updated = await safetyApi.acknowledgeSos(id)
      setAlerts(prev => prev.map(a => a.id === id ? updated : a))
    } finally {
      setActingId(null)
    }
  }

  async function resolve(id: string, status: 'resolved' | 'false_alarm' = 'resolved') {
    setActingId(id)
    try {
      const updated = await safetyApi.resolveSos(id, { status })
      setAlerts(prev => prev.map(a => a.id === id ? updated : a))
    } finally {
      setActingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {active.length > 0 && (
        <div
          className="rounded-2xl px-5 py-4 border-2 border-danger flex items-center gap-4"
          style={{ background: 'rgba(239,68,68,0.08)', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }}
        >
          <span className="text-2xl">🚨</span>
          <div className="flex-1">
            <p className="font-black text-danger text-lg">ACTIVE SOS</p>
            <p className="text-sm text-danger/80">
              {active[0]?.driver_name ?? active[0]?.user_name ?? 'Unknown'} ·{' '}
              {active[0]?.origin_address ?? '—'} → {active[0]?.destination_address ?? '—'}
            </p>
          </div>
          <span className="text-danger font-bold text-sm">{active[0] ? elapsed(active[0].created_at) : ''}</span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Active Now"     value={active.length}   change={active.length > 0 ? 'Needs action' : 'All clear'} changeType={active.length > 0 ? 'down' : 'neutral'} icon={Shield}        gradient="pink"   />
        <StatCard title="Resolved"       value={resolved}        change="All time"   changeType="up"    icon={CheckCircle}   gradient="green"  />
        <StatCard title="False Alarms"   value={falseAlarm}      change="All time"   changeType="neutral" icon={AlertTriangle} gradient="amber"  />
        <StatCard title="Total Alerts"   value={alerts.length}   change="All time"   changeType="neutral" icon={Clock}         gradient="blue"   />
      </div>

      {active.length > 0 && (
        <div>
          <h2 className="text-md font-bold text-text-primary mb-3">Active Alerts</h2>
          <div className="space-y-3">
            {active.map(sos => (
              <div
                key={sos.id}
                className="bg-surface rounded-2xl border border-danger/20 p-5 shadow-card"
                style={{ background: 'rgba(239,68,68,0.04)' }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                      <p className="font-bold text-text-primary text-lg">
                        {sos.driver_name ?? sos.user_name ?? 'Unknown'}
                      </p>
                      <span className="font-mono text-xs text-text-muted">
                        {sos.driver_phone ?? sos.user_phone ?? ''}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary">
                      {sos.origin_address ?? '—'} → {sos.destination_address ?? '—'}
                    </p>
                    {(sos.location_lat && sos.location_lng) && (
                      <p className="text-xs text-text-muted mt-1">
                        📍 {parseFloat(sos.location_lat).toFixed(4)}, {parseFloat(sos.location_lng).toFixed(4)}
                      </p>
                    )}
                    {sos.notes && <p className="text-xs text-text-muted mt-1">Note: {sos.notes}</p>}
                    <p className="text-xs text-danger font-semibold mt-2">{elapsed(sos.created_at)}</p>
                  </div>
                  <span className={`pill ${severityClass(sos.severity)}`}>{sos.severity}</span>
                </div>
                <div className="flex gap-2 mt-4">
                  {sos.status === 'triggered' && (
                    <button
                      disabled={actingId === sos.id}
                      onClick={() => void acknowledge(sos.id)}
                      className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    disabled={actingId === sos.id}
                    onClick={() => setConfirmAction({ id: sos.id, status: 'resolved' })}
                    className="px-4 py-2 text-sm font-semibold bg-success text-white rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    Mark Resolved
                  </button>
                  <button
                    disabled={actingId === sos.id}
                    onClick={() => setConfirmAction({ id: sos.id, status: 'false_alarm' })}
                    className="px-4 py-2 text-sm font-semibold border border-border rounded-xl hover:bg-surface-2 transition-colors text-text-secondary disabled:opacity-50"
                  >
                    False Alarm
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length === 0 && (
        <div className="admin-card flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle size={40} className="text-success mb-3" />
          <p className="font-bold text-text-primary">No active SOS alerts</p>
          <p className="text-sm text-text-muted mt-1">All riders and drivers are safe</p>
        </div>
      )}

      <div className="admin-card">
        <h2 className="text-md font-bold text-text-primary mb-4">All SOS Events</h2>
        {alerts.length === 0 ? (
          <p className="text-text-muted text-sm py-4 text-center">No SOS events recorded</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Person</th><th>Route</th><th>Severity</th><th>Status</th><th>Time</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(sos => (
                <tr key={sos.id} className="group">
                  <td className="font-mono text-xs text-primary">#{sos.id}</td>
                  <td className="font-semibold text-text-primary">
                    {sos.driver_name ?? sos.user_name ?? 'Unknown'}
                  </td>
                  <td className="text-text-secondary text-sm">
                    {sos.origin_address ?? '—'} → {sos.destination_address ?? '—'}
                  </td>
                  <td><span className={`pill ${severityClass(sos.severity)}`}>{sos.severity}</span></td>
                  <td><span className={`pill ${statusClass(sos.status)}`}>{sos.status.replace(/_/g, ' ')}</span></td>
                  <td className="text-text-muted text-sm">{elapsed(sos.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={open => { if (!open) setConfirmAction(null) }}
        title={confirmAction?.status === 'false_alarm' ? 'Mark as false alarm?' : 'Mark SOS resolved?'}
        description={
          confirmAction?.status === 'false_alarm'
            ? 'This will dismiss the alert as a false alarm. Only do this if you are certain no emergency occurred.'
            : 'This will close the SOS alert and notify the parties involved.'
        }
        confirmLabel={confirmAction?.status === 'false_alarm' ? 'False Alarm' : 'Mark Resolved'}
        variant={confirmAction?.status === 'false_alarm' ? 'warning' : 'success'}
        onConfirm={() => {
          if (confirmAction) void resolve(confirmAction.id, confirmAction.status)
        }}
      />
    </div>
  )
}
