'use client'
import { useState } from 'react'
import { AlertTriangle, Clock, CheckCircle, Zap } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import { mockDisputes } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Dispute = typeof mockDisputes[number]

const SLA_CLASSES: Record<string, string> = {
  ok:       'text-success',
  warning:  'text-warning',
  critical: 'text-danger font-bold',
}

export default function DisputesPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<Dispute | null>(null)
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')

  const highPriority = mockDisputes.filter(d => d.priority === 'high' && d.status !== 'resolved')

  const filtered = mockDisputes.filter(d => {
    if (statusFilter && d.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!d.id.toLowerCase().includes(q) && !d.initiatorName.toLowerCase().includes(q)) return false
    }
    return true
  })

  const columns = [
    { key: 'id', header: 'ID', render: (d: Dispute) => <span className="font-mono text-xs text-primary">{d.id}</span> },
    {
      key: 'type', header: 'Type',
      render: (d: Dispute) => <span className="capitalize text-text-primary font-medium">{d.type.replace(/_/g, ' ')}</span>,
    },
    {
      key: 'initiatorName', header: 'Initiator',
      render: (d: Dispute) => (
        <div>
          <p className="font-medium text-text-primary">{d.initiatorName}</p>
          <p className="text-xs text-text-muted capitalize">{d.initiator}</p>
        </div>
      ),
    },
    { key: 'rideCode', header: 'Ride', render: (d: Dispute) => <span className="font-mono text-xs text-text-muted">{d.rideCode}</span> },
    { key: 'status',   header: 'Status',   render: (d: Dispute) => <StatusPill status={d.status} /> },
    {
      key: 'priority', header: 'Priority',
      render: (d: Dispute) => (
        <span className={cn('pill', d.priority === 'high' ? 'pill-danger' : 'pill-info')}>
          {d.priority === 'high' && <Zap size={10} />}
          {d.priority}
        </span>
      ),
    },
    {
      key: 'slaDue', header: 'SLA Due',
      render: (d: Dispute) => (
        <span className={cn('text-sm', SLA_CLASSES[d.slaUrgency])}>{d.slaDue}</span>
      ),
    },
    {
      key: 'assignedTo', header: 'Assigned',
      render: (d: Dispute) => d.assignedTo
        ? <span className="text-text-secondary">{d.assignedTo}</span>
        : <span className="text-text-muted italic text-xs">Unassigned</span>,
    },
    { key: 'createdAt', header: 'Created', render: (d: Dispute) => <span className="text-text-muted">{d.createdAt}</span> },
    {
      key: 'actions', header: '',
      render: (d: Dispute) => (
        <button onClick={e => { e.stopPropagation(); setSelected(d) }} className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary">
          Review
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      {/* High priority banner */}
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
        <StatCard title="Open"            value={mockDisputes.filter(d=>d.status==='open').length}         change="Needs action"    changeType="neutral" icon={AlertTriangle} gradient="blue"   />
        <StatCard title="Under Review"    value={mockDisputes.filter(d=>d.status==='under_review').length} change="In progress"     changeType="neutral" icon={Clock}         gradient="amber"  />
        <StatCard title="Resolved Today"  value={0}                                                         change="Target: 12"     changeType="neutral" icon={CheckCircle}   gradient="green"  />
        <StatCard title="Avg Resolution"  value="4.2h"                                                      change="-1.1h vs yesterday" changeType="up"  icon={Clock}         gradient="purple" />
      </div>

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by ID or name…"
            filters={[{
              key: 'status', label: 'All Statuses',
              options: [
                { value: 'open',         label: 'Open'         },
                { value: 'under_review', label: 'Under Review' },
                { value: 'resolved',     label: 'Resolved'     },
              ],
              value: statusFilter,
              onChange: setStatusFilter,
            }]}
            onExport={() => {}}
          />
        </div>
        <DataTable
          columns={columns}
          data={filtered as unknown as Record<string, unknown>[]}
          onRowClick={row => setSelected(row as unknown as Dispute)}
          emptyMessage="No disputes match your filters"
        />
      </div>

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={`Dispute ${selected?.id ?? ''}`} width="lg">
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={selected.status} />
              <span className={cn('pill', selected.priority === 'high' ? 'pill-danger' : 'pill-info')}>
                {selected.priority === 'high' && <Zap size={10} />} {selected.priority}
              </span>
              <span className={cn('text-sm font-semibold', SLA_CLASSES[selected.slaUrgency])}>
                SLA: {selected.slaDue}
              </span>
            </div>

            {/* Ride context */}
            <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
              <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Ride</p>
              <p className="font-mono text-sm text-primary">{selected.rideCode}</p>
              <p className="text-sm text-text-secondary mt-1 capitalize">{selected.type.replace(/_/g,' ')} · Raised by {selected.initiatorName} ({selected.initiator})</p>
            </div>

            {/* Description */}
            <div>
              <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Description</p>
              <p className="text-sm text-text-secondary leading-relaxed bg-surface-2 rounded-xl p-4 border border-border-light">{selected.description}</p>
            </div>

            {/* Resolution */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Resolve</p>
              <select
                value={outcome}
                onChange={e => setOutcome(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">Select outcome…</option>
                {['refund_full','refund_partial','no_refund','warning_driver','warning_user','driver_suspended','dismissed','escalated','under_investigation'].map(o => (
                  <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Resolution notes…"
                className="w-full px-3 py-2.5 text-sm border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary transition-colors resize-none placeholder:text-text-muted"
              />
              <button
                disabled={!outcome}
                className="w-full py-3 bg-primary text-white font-semibold rounded-xl text-sm hover:bg-primary-dark transition-colors disabled:opacity-40"
              >
                Mark Resolved
              </button>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  )
}
