'use client'
import React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Users } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { adminUserApi, type AdminUserItem } from '@/lib/admin-api'
import { cn } from '@/lib/utils'

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function initials(name: string | null) {
  if (!name) return '?'
  return name.split(' ').map(p => p[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-light last:border-b-0">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: j === 0 ? '140px' : '80px' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

const LIMIT = 20

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [selected, setSelected] = useState<AdminUserItem | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'suspend' | 'reinstate'; user: AdminUserItem } | null>(null)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { page, limit: LIMIT }
      if (statusFilter) params['status'] = statusFilter
      if (debouncedSearch) params['search'] = debouncedSearch
      const data = await adminUserApi.list(params as Parameters<typeof adminUserApi.list>[0])
      setUsers(data.users)
      setTotal(data.pagination.total)
      setPages(data.pagination.pages)
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, debouncedSearch])

  useEffect(() => { void fetchUsers() }, [fetchUsers])

  async function handleStatusAction() {
    if (!confirmAction) return
    setActionError('')
    try {
      const newStatus = confirmAction.type === 'suspend' ? 'suspended' : 'active'
      await adminUserApi.updateStatus(confirmAction.user.id, newStatus)
      setUsers(prev => prev.map(u => u.id === confirmAction.user.id ? { ...u, status: newStatus } : u))
      if (selected?.id === confirmAction.user.id) setSelected(prev => prev ? { ...prev, status: newStatus } : prev)
      setConfirmAction(null)
    } catch {
      setActionError('Failed to update status. Please try again.')
    }
  }

  const columns = [
    {
      key: 'name', header: 'User',
      render: (u: AdminUserItem) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-info-light flex items-center justify-center flex-shrink-0">
            <span className="font-bold text-info text-xs">{initials(u.name)}</span>
          </div>
          <div>
            <p className="font-semibold text-text-primary">{u.name}</p>
            <p className="text-xs text-text-muted">{u.email ?? '—'}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone',  header: 'Phone',       render: (u: AdminUserItem) => <span className="text-text-secondary">{u.phone}</span> },
    { key: 'status', header: 'Status',       render: (u: AdminUserItem) => <StatusPill status={u.status} /> },
    { key: 'total_rides', header: 'Rides',   render: (u: AdminUserItem) => <span className="font-semibold text-text-primary">{u.total_rides}</span> },
    {
      key: 'wallet_balance', header: 'Wallet',
      render: (u: AdminUserItem) => {
        const bal = parseFloat(u.wallet_balance)
        return <span className={cn('font-semibold', bal > 0 ? 'text-success' : 'text-text-muted')}>₹{bal.toLocaleString('en-IN')}</span>
      },
    },
    {
      key: 'rating_avg', header: 'Rating',
      render: (u: AdminUserItem) => u.rating_avg
        ? <span className="text-text-secondary">⭐ {parseFloat(u.rating_avg).toFixed(1)}</span>
        : <span className="text-text-muted">—</span>,
    },
    { key: 'created_at', header: 'Joined', render: (u: AdminUserItem) => <span className="text-text-muted text-xs">{fmt(u.created_at)}</span> },
    {
      key: 'actions', header: '',
      render: (u: AdminUserItem) => (
        <button onClick={e => { e.stopPropagation(); setSelected(u) }} className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary">
          View
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <Users className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-lg font-bold text-text-primary">Users</h2>
          <p className="text-xs text-text-muted">{total} total registered users</p>
        </div>
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
              onChange: (v) => { setStatusFilter(v); setPage(1) },
            }]}
          />
        </div>
        {loading
          ? <table className="w-full"><tbody><SkeletonRows cols={8} /></tbody></table>
          : (
            <DataTable
              columns={columns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
              data={users as unknown as Record<string, unknown>[]}
              onRowClick={row => setSelected(row as unknown as AdminUserItem)}
              emptyMessage="No users found"
            />
          )
        }
        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted">{total} total</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Prev</button>
              <span className="px-3 py-1 text-xs text-text-muted">{page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      <SlideOver isOpen={!!selected} onClose={() => { setSelected(null); setActionError('') }} title={selected?.name ?? ''}>
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-info-light flex items-center justify-center">
                <span className="font-black text-info text-xl">{initials(selected.name)}</span>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xl font-bold text-text-primary">{selected.name}</p>
                  <StatusPill status={selected.status} />
                </div>
                <p className="text-sm text-text-secondary">{selected.phone}</p>
                <p className="text-xs text-text-muted">{selected.email ?? '—'}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Rides',  value: String(selected.total_rides) },
                { label: 'Wallet',       value: `₹${parseFloat(selected.wallet_balance).toLocaleString('en-IN')}` },
                { label: 'Member Since', value: fmt(selected.created_at) },
              ].map(s => (
                <div key={s.label} className="bg-surface-2 rounded-xl p-3 text-center border border-border-light">
                  <p className="text-md font-black text-text-primary">{s.value}</p>
                  <p className="text-xs text-text-muted">{s.label}</p>
                </div>
              ))}
            </div>

            {actionError && (
              <p className="text-sm text-danger bg-danger-light rounded-lg px-3 py-2">{actionError}</p>
            )}

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
        onConfirm={handleStatusAction}
      />
    </div>
  )
}
