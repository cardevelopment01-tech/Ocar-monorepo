'use client'
import { useState } from 'react'
import { Car, CheckCircle, XCircle, IndianRupee } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import { mockRides } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Ride = typeof mockRides[number]

const TIMELINE = [
  { label: 'Requested',       time: '10:42 AM', actor: 'User' },
  { label: 'Driver Accepted', time: '10:43 AM', actor: 'System' },
  { label: 'Driver Arrived',  time: '10:51 AM', actor: 'Driver' },
  { label: 'Trip Started',    time: '10:53 AM', actor: 'Driver' },
  { label: 'Completed',       time: '11:24 AM', actor: 'System' },
]

export default function RidesPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<Ride | null>(null)

  const filtered = mockRides.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!r.code.toLowerCase().includes(q) && !r.user.name.toLowerCase().includes(q) && !r.user.phone.includes(q)) return false
    }
    return true
  })

  const columns = [
    {
      key: 'code', header: 'Ride ID',
      render: (r: Ride) => <span className="font-mono text-xs text-primary">{r.code}</span>,
    },
    {
      key: 'user', header: 'User',
      render: (r: Ride) => (
        <div>
          <p className="font-semibold text-text-primary">{r.user.name}</p>
          <p className="text-xs text-text-muted">{r.user.phone}</p>
        </div>
      ),
    },
    {
      key: 'driver', header: 'Driver',
      render: (r: Ride) => r.driver ? (
        <div>
          <p className="font-medium text-text-secondary">{r.driver.name}</p>
          <p className="text-xs text-text-muted font-mono">{r.driver.plate}</p>
        </div>
      ) : <span className="text-text-muted italic text-xs">Unassigned</span>,
    },
    {
      key: 'route', header: 'Route',
      render: (r: Ride) => (
        <p className="text-text-secondary">
          {r.from}<span className="text-text-muted mx-1">→</span>{r.to}
        </p>
      ),
    },
    { key: 'type',   header: 'Type',   render: (r: Ride) => <StatusPill status={r.type} /> },
    {
      key: 'fare', header: 'Fare',
      render: (r: Ride) => <span className="font-bold text-text-primary">₹{r.fare.toLocaleString('en-IN')}</span>,
    },
    { key: 'status', header: 'Status', render: (r: Ride) => <StatusPill status={r.status} /> },
    {
      key: 'time', header: 'Time',
      render: (r: Ride) => <span className="text-text-muted">{r.time}</span>,
    },
    {
      key: 'actions', header: '',
      render: (r: Ride) => (
        <button
          onClick={e => { e.stopPropagation(); setSelected(r) }}
          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary"
        >
          View
        </button>
      ),
    },
  ]

  const completed = mockRides.filter(r => r.status === 'completed').length
  const cancelled  = mockRides.filter(r => r.status === 'cancelled').length
  const revenue    = mockRides.reduce((s, r) => s + r.fare, 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Today"  value={mockRides.length} change="+12%"              changeType="up"      icon={Car}          gradient="blue"   />
        <StatCard title="Completed"    value={completed}        change={`${Math.round(completed/mockRides.length*100)}% rate`} changeType="up" icon={CheckCircle} gradient="green" />
        <StatCard title="Cancelled"    value={cancelled}        change="Monitor closely"   changeType="down"    icon={XCircle}      gradient="amber"  />
        <StatCard title="Revenue"      value={`₹${revenue.toLocaleString('en-IN')}`} change="+8% today" changeType="up" icon={IndianRupee}  gradient="purple" />
      </div>

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by Ride ID or user phone…"
            filters={[{
              key: 'status', label: 'All Statuses',
              options: [
                { value: 'completed',   label: 'Completed'   },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'requested',   label: 'Requested'   },
                { value: 'cancelled',   label: 'Cancelled'   },
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
          onRowClick={row => setSelected(row as unknown as Ride)}
          emptyMessage="No rides match your filters"
        />
      </div>

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.code ?? ''}>
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <StatusPill status={selected.status} />
              <span className="text-text-muted text-sm">{selected.time}</span>
            </div>

            {/* Parties */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Rider', name: selected.user.name, sub: selected.user.phone },
                { label: 'Driver', name: selected.driver?.name ?? 'Unassigned', sub: selected.driver?.plate ?? '' },
              ].map(p => (
                <div key={p.label} className="bg-surface-2 rounded-xl p-3 border border-border-light">
                  <p className="text-xs text-text-muted uppercase tracking-wide mb-1">{p.label}</p>
                  <p className="font-semibold text-text-primary">{p.name}</p>
                  <p className="text-xs text-text-muted">{p.sub}</p>
                </div>
              ))}
            </div>

            {/* Route */}
            <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
              <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Route</p>
              <p className="font-medium text-text-primary">{selected.from} → {selected.to}</p>
              <div className="flex items-center gap-2 mt-1">
                <StatusPill status={selected.type} />
                <span className="text-lg font-bold text-text-primary">₹{selected.fare.toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Timeline */}
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Timeline</p>
              <div className="space-y-0">
                {TIMELINE.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3 relative">
                    <div className="flex flex-col items-center">
                      <div className={cn('w-3 h-3 rounded-full mt-0.5 flex-shrink-0', i === TIMELINE.length - 1 ? 'bg-success' : 'bg-primary')} />
                      {i < TIMELINE.length - 1 && <div className="w-px flex-1 bg-border min-h-[28px]" />}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm font-semibold text-text-primary">{ev.label}</p>
                      <p className="text-xs text-text-muted">{ev.time} · {ev.actor}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Fare breakdown */}
            <div className="bg-surface-2 rounded-xl p-4 border border-border-light space-y-2">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Fare Breakdown</p>
              {[
                { label: 'Base Fare',   value: `₹${Math.round(selected.fare * 0.7).toLocaleString('en-IN')}` },
                { label: 'Per KM',      value: `₹${Math.round(selected.fare * 0.2).toLocaleString('en-IN')}` },
                { label: 'Commission',  value: `-₹${Math.round(selected.fare * 0.2).toLocaleString('en-IN')}`, muted: true },
                { label: 'Driver Gets', value: `₹${Math.round(selected.fare * 0.8).toLocaleString('en-IN')}`,  bold: true },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span className="text-text-secondary">{r.label}</span>
                  <span className={cn(r.bold ? 'font-bold text-success' : r.muted ? 'text-danger' : 'text-text-primary')}>{r.value}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button className="flex-1 py-2.5 bg-primary text-white font-semibold rounded-xl text-sm hover:bg-primary-dark transition-colors">View Full Details</button>
              <button className="flex-1 py-2.5 border border-border text-text-secondary font-semibold rounded-xl text-sm hover:bg-surface-2 transition-colors">Raise Dispute</button>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  )
}
