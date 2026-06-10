'use client'
import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, Clock, CheckCircle, Zap } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import { safetyApi, type Dispute } from '@/lib/safety-api'
import { cn } from '@/lib/utils'

const OUTCOMES = [
  'no_action', 'fare_adjusted', 'full_refund', 'partial_refund',
  'driver_warned', 'driver_suspended', 'driver_banned',
  'user_warned', 'user_suspended', 'item_recovered',
]

function slaUrgency(dueDateIso: string): 'ok' | 'warning' | 'critical' {
  const hoursLeft = (new Date(dueDateIso).getTime() - Date.now()) / 3600000
  if (hoursLeft < 0)   return 'critical'
  if (hoursLeft < 12)  return 'critical'
  if (hoursLeft < 24)  return 'warning'
  return 'ok'
}

function slaLabel(dueDateIso: string): string {
  const hoursLeft = (new Date(dueDateIso).getTime() - Date.now()) / 3600000
  if (hoursLeft < 0)   return 'Overdue'
  if (hoursLeft < 1)   return '<1h remaining'
  if (hoursLeft < 24)  return `${Math.floor(hoursLeft)}h remaining`
  return `${Math.floor(hoursLeft / 24)}d remaining`
}

const SLA_CLASSES: Record<string, string> = {
  ok:       'text-success',
  warning:  'text-warning',
  critical: 'text-danger font-bold',
}

export default function DisputesPage() {
  const [disputes,     setDisputes]     = useState<Dispute[]>([])
  const [total,        setTotal]        = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected,     setSelected]     = useState<Dispute | null>(null)
  const [outcome,      setOutcome]      = useState('')
  const [notes,        setNotes]        = useState('')
  const [refundAmt,    setRefundAmt]    = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [assigning,    setAssigning]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: { status?: string; limit: number } = { limit: 50 }
      if (statusFilter) params.status = statusFilter
      const data = await safetyApi.getDisputes(params)
      setDisputes(data.disputes)
      setTotal(data.total)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { void load() }, [load])

  const filtered = search
    ? disputes.filter(d => {
        const q = search.toLowerCase()
        return (
          d.id.toLowerCase().includes(q) ||
          (d.user_name  ?? '').toLowerCase().includes(q) ||
          (d.driver_name ?? '').toLowerCase().includes(q) ||
          d.ride_id.toLowerCase().includes(q)
        )
      })
    : disputes

  const highPriority = disputes.filter(d => d.priority <= 2 && d.status !== 'resolved' && d.status !== 'withdrawn')

  const needsRefund = outcome === 'full_refund' || outcome === 'partial_refund' || outcome === 'fare_adjusted'

  async function handleAssign() {
    if (!selected) return
    setAssigning(true)
    try {
      const updated = await safetyApi.assignDispute(selected.id)
      setDisputes(prev => prev.map(d => d.id === selected.id ? updated : d))
      setSelected(updated)
    } finally {
      setAssigning(false)
    }
  }

  async function handleResolve() {
    if (!selected || !outcome) return
    setSubmitting(true)
    try {
      const body: { outcome: string; note: string; refundAmount?: number } = {
        outcome,
        note: notes,
      }
      if (needsRefund && refundAmt) body.refundAmount = parseFloat(refundAmt)
      const updated = await safetyApi.resolveDispute(selected.id, body)
      setDisputes(prev => prev.map(d => d.id === selected.id ? updated : d))
      setSelected(null)
      setOutcome('')
      setNotes('')
      setRefundAmt('')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    {
      key: 'id', header: 'ID',
      render: (d: Record<string, unknown>) => <span className="font-mono text-xs text-primary">#{(d as Dispute).id}</span>,
    },
    {
      key: 'type', header: 'Type',
      render: (d: Record<string, unknown>) => (
        <span className="capitalize text-text-primary font-medium">
          {(d as Dispute).type.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'initiator', header: 'Initiator',
      render: (d: Record<string, unknown>) => {
        const dsp = d as Dispute
        return (
          <div>
            <p className="font-medium text-text-primary">
              {dsp.initiator === 'user' ? (dsp.user_name ?? '—') : (dsp.driver_name ?? '—')}
            </p>
            <p className="text-xs text-text-muted capitalize">{dsp.initiator}</p>
          </div>
        )
      },
    },
    {
      key: 'ride_id', header: 'Ride',
      render: (d: Record<string, unknown>) => (
        <span className="font-mono text-xs text-text-muted">#{(d as Dispute).ride_id}</span>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (d: Record<string, unknown>) => <StatusPill status={(d as Dispute).status} />,
    },
    {
      key: 'priority', header: 'Priority',
      render: (d: Record<string, unknown>) => {
        const dsp = d as Dispute
        const isHigh = dsp.priority <= 2
        return (
          <span className={cn('pill', isHigh ? 'pill-danger' : 'pill-info')}>
            {isHigh && <Zap size={10} />}
            {isHigh ? 'high' : 'normal'}
          </span>
        )
      },
    },
    {
      key: 'sla_due_at', header: 'SLA Due',
      render: (d: Record<string, unknown>) => {
        const dsp = d as Dispute
        const urg = slaUrgency(dsp.sla_due_at)
        return <span className={cn('text-sm', SLA_CLASSES[urg])}>{slaLabel(dsp.sla_due_at)}</span>
      },
    },
    {
      key: 'assigned_to_email', header: 'Assigned',
      render: (d: Record<string, unknown>) => {
        const dsp = d as Dispute
        return dsp.assigned_to_email
          ? <span className="text-text-secondary text-sm">{dsp.assigned_to_email}</span>
          : <span className="text-text-muted italic text-xs">Unassigned</span>
      },
    },
    {
      key: 'actions', header: '',
      render: (d: Record<string, unknown>) => (
        <button
          onClick={e => { e.stopPropagation(); setSelected(d as Dispute) }}
          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary"
        >
          Review
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      {highPriority.length > 0 && (
        <div className="bg-danger-light border border-danger/20 rounded-2xl px-5 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-danger/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={16} className="text-danger" />
          </div>
          <p className="text-sm font-bold text-danger">
            {highPriority.length} high priority dispute{highPriority.length > 1 ? 's' : ''} require immediate attention
          </p>
          <span className="ml-auto pill pill-danger animate-pulse">{highPriority.length} urgent</span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Open"          value={disputes.filter(d=>d.status==='open').length}         change="Needs action" changeType="neutral" icon={AlertTriangle} gradient="blue"   />
        <StatCard title="Under Review"  value={disputes.filter(d=>d.status==='under_review').length} change="In progress"  changeType="neutral" icon={Clock}         gradient="amber"  />
        <StatCard title="Resolved"      value={disputes.filter(d=>d.status==='resolved').length}     change="All time"     changeType="up"      icon={CheckCircle}   gradient="green"  />
        <StatCard title="Total"         value={total}                                                 change="All time"     changeType="neutral" icon={Clock}         gradient="purple" />
      </div>

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by ID, name, or ride code…"
            filters={[{
              key: 'status', label: 'All Statuses',
              options: [
                { value: 'open',         label: 'Open'         },
                { value: 'under_review', label: 'Under Review' },
                { value: 'pending_info', label: 'Pending Info' },
                { value: 'escalated',    label: 'Escalated'    },
                { value: 'resolved',     label: 'Resolved'     },
                { value: 'withdrawn',    label: 'Withdrawn'    },
              ],
              value: statusFilter,
              onChange: setStatusFilter,
            }]}
            onExport={() => {}}
          />
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered as unknown as Record<string, unknown>[]}
            onRowClick={row => setSelected(row as unknown as Dispute)}
            emptyMessage="No disputes match your filters"
          />
        )}
      </div>

      <SlideOver isOpen={!!selected} onClose={() => { setSelected(null); setOutcome(''); setNotes(''); setRefundAmt('') }} title={`Dispute #${selected?.id ?? ''}`} width="lg">
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={selected.status} />
              <span className={cn('pill', selected.priority <= 2 ? 'pill-danger' : 'pill-info')}>
                {selected.priority <= 2 && <Zap size={10} />}
                {selected.priority <= 2 ? 'high' : 'normal'}
              </span>
              <span className={cn('text-sm font-semibold', SLA_CLASSES[slaUrgency(selected.sla_due_at)])}>
                SLA: {slaLabel(selected.sla_due_at)}
              </span>
            </div>

            <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
              <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Ride</p>
              <p className="font-mono text-sm text-primary">#{selected.ride_id}</p>
              <p className="text-sm text-text-secondary mt-1 capitalize">
                {selected.type.replace(/_/g, ' ')} · Raised by{' '}
                {selected.initiator === 'user' ? (selected.user_name ?? 'user') : (selected.driver_name ?? 'driver')}{' '}
                ({selected.initiator})
              </p>
              <p className="text-xs text-text-muted mt-1">
                {selected.origin_address ?? '—'} → {selected.destination_address ?? '—'}
              </p>
            </div>

            <div>
              <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Description</p>
              <p className="text-sm text-text-secondary leading-relaxed bg-surface-2 rounded-xl p-4 border border-border-light">
                {selected.description}
              </p>
            </div>

            {selected.outcome && (
              <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
                <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Outcome</p>
                <p className="font-medium capitalize text-text-primary">{selected.outcome.replace(/_/g, ' ')}</p>
                {selected.outcome_note && <p className="text-sm text-text-secondary mt-1">{selected.outcome_note}</p>}
              </div>
            )}

            {selected.status !== 'resolved' && selected.status !== 'withdrawn' && (
              <div className="space-y-3">
                {!selected.assigned_to && (
                  <button
                    onClick={() => void handleAssign()}
                    disabled={assigning}
                    className="w-full py-2.5 border border-border rounded-xl text-sm font-semibold text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40"
                  >
                    {assigning ? 'Assigning…' : 'Assign to Me'}
                  </button>
                )}

                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Resolve</p>
                <select
                  value={outcome}
                  onChange={e => setOutcome(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">Select outcome…</option>
                  {OUTCOMES.map(o => (
                    <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
                  ))}
                </select>

                {needsRefund && (
                  <input
                    type="number"
                    value={refundAmt}
                    onChange={e => setRefundAmt(e.target.value)}
                    placeholder="Refund amount (₹)…"
                    className="w-full px-3 py-2.5 text-sm border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary transition-colors"
                  />
                )}

                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Resolution notes…"
                  className="w-full px-3 py-2.5 text-sm border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary transition-colors resize-none placeholder:text-text-muted"
                />
                <button
                  disabled={!outcome || !notes || submitting}
                  onClick={() => void handleResolve()}
                  className="w-full py-3 bg-primary text-white font-semibold rounded-xl text-sm hover:bg-primary-dark transition-colors disabled:opacity-40"
                >
                  {submitting ? 'Resolving…' : 'Mark Resolved'}
                </button>
              </div>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  )
}
