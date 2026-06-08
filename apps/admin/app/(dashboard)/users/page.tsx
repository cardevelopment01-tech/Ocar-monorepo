'use client'
import { useState } from 'react'
import { Users, Activity, UserPlus, Star } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { mockUsers, mockRides } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type AppUser = typeof mockUsers[number]

export default function UsersPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<AppUser | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'suspend' | 'reinstate'; user: AppUser } | null>(null)

  const filtered = mockUsers.filter(u => {
    if (statusFilter && u.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!u.name.toLowerCase().includes(q) && !u.phone.includes(q) && !u.email.toLowerCase().includes(q)) return false
    }
    return true
  })

  const columns = [
    {
      key: 'name', header: 'User',
      render: (u: AppUser) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-info-light flex items-center justify-center flex-shrink-0">
            <span className="font-bold text-info text-xs">{u.name.split(' ').map(p => p[0]).join('').slice(0,2)}</span>
          </div>
          <div>
            <p className="font-semibold text-text-primary">{u.name}</p>
            <p className="text-xs text-text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone',        header: 'Phone',        render: (u: AppUser) => <span className="text-text-secondary">{u.phone}</span> },
    { key: 'status',       header: 'Status',        render: (u: AppUser) => <StatusPill status={u.status} /> },
    { key: 'totalRides',   header: 'Total Rides',   render: (u: AppUser) => <span className="font-semibold text-text-primary">{u.totalRides}</span> },
    {
      key: 'walletBalance', header: 'Wallet',
      render: (u: AppUser) => <span className={cn('font-semibold', u.walletBalance > 0 ? 'text-success' : 'text-text-muted')}>₹{u.walletBalance.toLocaleString('en-IN')}</span>,
    },
    { key: 'joinedAt', header: 'Joined', render: (u: AppUser) => <span className="text-text-muted">{u.joinedAt}</span> },
    {
      key: 'actions', header: '',
      render: (u: AppUser) => (
        <button onClick={e => { e.stopPropagation(); setSelected(u) }} className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary">
          View
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Total Users"     value={mockUsers.length}                                      change="All time"      changeType="neutral" icon={Users}    gradient="blue"   />
        <StatCard title="Active Today"    value={mockUsers.filter(u=>u.status==='active').length}        change="+4% week"     changeType="up"      icon={Activity} gradient="green"  />
        <StatCard title="New This Week"   value={2}                                                      change="+2 from last" changeType="up"      icon={UserPlus} gradient="purple" />
      </div>

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by name, phone or email…"
            filters={[{
              key: 'status', label: 'All Statuses',
              options: [
                { value: 'active',    label: 'Active'    },
                { value: 'suspended', label: 'Suspended' },
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
          onRowClick={row => setSelected(row as unknown as AppUser)}
          emptyMessage="No users found"
        />
      </div>

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-info-light flex items-center justify-center">
                <span className="font-black text-info text-xl">{selected.name.split(' ').map(p=>p[0]).join('').slice(0,2)}</span>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xl font-bold text-text-primary">{selected.name}</p>
                  <StatusPill status={selected.status} />
                </div>
                <p className="text-sm text-text-secondary">{selected.phone}</p>
                <p className="text-xs text-text-muted">{selected.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Rides',   value: selected.totalRides },
                { label: 'Wallet',        value: `₹${selected.walletBalance.toLocaleString('en-IN')}` },
                { label: 'Member Since',  value: selected.joinedAt },
              ].map(s => (
                <div key={s.label} className="bg-surface-2 rounded-xl p-3 text-center border border-border-light">
                  <p className="text-md font-black text-text-primary">{s.value}</p>
                  <p className="text-xs text-text-muted">{s.label}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Recent Rides</p>
              <div className="space-y-2">
                {mockRides.filter(r => r.user.name === selected.name).slice(0, 3).map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-surface-2 rounded-xl px-3 py-2.5 border border-border-light">
                    <div>
                      <p className="text-sm font-medium text-text-primary">{r.from} → {r.to}</p>
                      <p className="text-xs text-text-muted">{r.time}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-text-primary">₹{r.fare}</p>
                      <StatusPill status={r.status} />
                    </div>
                  </div>
                ))}
                {mockRides.filter(r => r.user.name === selected.name).length === 0 && (
                  <p className="text-sm text-text-muted text-center py-4">No recent rides</p>
                )}
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {selected.status === 'active' && (
                <button onClick={() => setConfirmAction({ type: 'suspend', user: selected })} className="w-full py-2.5 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning-light transition-colors">
                  Suspend Account
                </button>
              )}
              {selected.status === 'suspended' && (
                <button onClick={() => setConfirmAction({ type: 'reinstate', user: selected })} className="w-full py-2.5 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">
                  Reinstate Account
                </button>
              )}
            </div>
          </div>
        )}
      </SlideOver>

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={v => { if (!v) setConfirmAction(null) }}
        title={confirmAction?.type === 'suspend' ? 'Suspend Account' : 'Reinstate Account'}
        description={confirmAction?.type === 'suspend'
          ? `Suspend ${confirmAction.user.name}? They will not be able to book rides.`
          : `Reinstate ${confirmAction?.user.name}?`}
        confirmLabel={confirmAction?.type === 'suspend' ? 'Suspend' : 'Reinstate'}
        variant={confirmAction?.type === 'suspend' ? 'warning' : 'success'}
        onConfirm={() => setConfirmAction(null)}
      />
    </div>
  )
}
