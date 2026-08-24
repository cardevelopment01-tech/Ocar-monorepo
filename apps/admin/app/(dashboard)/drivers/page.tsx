'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, UserCheck, Clock, ShieldOff } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ReasonDialog from '@/components/ui/ReasonDialog'
import SuccessToast from '@/components/ui/SuccessToast'
import { adminDriverApi, type DriverListItem } from '@/lib/admin-api'
import { cn } from '@/lib/utils'
import { InitialsAvatar, fmt } from './shared'

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-light last:border-b-0">
          {Array.from({ length: 8 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: j === 0 ? 140 : j === 7 ? 60 : 80 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// Only actions reachable from the pending-approval banner's fast path.
// Suspend/reinstate/ban-from-active live on the driver detail page's
// persistent action bar now.
type ActionType = 'approve' | 'rejectDocs' | 'ban'
interface PendingAction { type: ActionType; driverId: string; driverName: string }
const LIMIT = 20

export default function DriversPage() {
  const router = useRouter()

  const [drivers, setDrivers]             = useState<DriverListItem[]>([])
  const [total, setTotal]                 = useState(0)
  const [pages, setPages]                 = useState(1)
  const [page, setPage]                   = useState(1)
  const [listLoading, setListLoading]     = useState(true)

  const [search, setSearch]                       = useState('')
  const [statusFilter, setStatusFilter]           = useState('')
  const debounceRef                               = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch]     = useState('')

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError]     = useState('')
  const [successMsg, setSuccessMsg]       = useState<string | null>(null)

  // ── debounce search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // ── fetch list ─────────────────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await adminDriverApi.list({ status: statusFilter || undefined, search: debouncedSearch || undefined, page, limit: LIMIT })
      setDrivers(res.drivers)
      setTotal(res.pagination.total)
      setPages(res.pagination.pages)
    } catch { /* keep stale */ }
    finally { setListLoading(false) }
  }, [statusFilter, debouncedSearch, page])

  useEffect(() => { fetchList() }, [fetchList])

  // ── inline banner actions (fast path — no navigation required) ────────────
  function openAction(type: ActionType, driver: DriverListItem) {
    setPendingAction({ type, driverId: driver.id, driverName: driver.full_name ?? driver.phone })
  }
  async function executeAction(reason?: string) {
    if (!pendingAction) return
    setActionLoading(true); setActionError('')
    try {
      const { type, driverId } = pendingAction
      if (type === 'approve')     await adminDriverApi.approve(driverId)
      if (type === 'rejectDocs')  await adminDriverApi.rejectDocs(driverId, reason!)
      if (type === 'ban')         await adminDriverApi.ban(driverId, reason!)
      setPendingAction(null)
      await fetchList()
      setSuccessMsg(type === 'approve' ? 'Driver approved' : type === 'rejectDocs' ? 'Documents rejected' : 'Driver banned')
    } catch { setActionError('Action failed. Please try again.') }
    finally { setActionLoading(false) }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const pending = drivers.filter(d => d.status === 'pending_approval')

  // ── table columns ──────────────────────────────────────────────────────────
  const columns = [
    {
      key: 'name', header: 'Driver',
      render: (d: DriverListItem) => (
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={d.full_name ?? d.phone} />
          <div>
            <p className="font-semibold text-text-primary">{d.full_name ?? '—'}</p>
            <p className="text-xs text-text-muted">{d.email ?? d.phone}</p>
          </div>
        </div>
      ),
    },
    { key: 'code',  header: 'Code',  render: (d: DriverListItem) => <span className="font-mono text-xs text-primary">{d.code}</span> },
    { key: 'phone', header: 'Phone', render: (d: DriverListItem) => <span className="text-text-secondary">{d.phone}</span> },
    {
      key: 'vehicle', header: 'Vehicle',
      render: (d: DriverListItem) => d.vehicle ? (
        <div>
          <p className="text-text-primary font-medium font-mono text-xs">{d.vehicle.number_plate}</p>
          <StatusPill status={d.vehicle.category.toLowerCase()} />
        </div>
      ) : <span className="text-text-muted">—</span>,
    },
    { key: 'status', header: 'Status', render: (d: DriverListItem) => <StatusPill status={d.status} /> },
    {
      key: 'docs', header: 'Docs',
      render: (d: DriverListItem) => (
        <span className={cn('text-xs font-semibold',
          d.docs_approved === d.docs_submitted && d.docs_submitted > 0 ? 'text-success' : 'text-text-secondary'
        )}>
          {d.docs_approved}/{d.docs_submitted}
        </span>
      ),
    },
    { key: 'joined', header: 'Joined', render: (d: DriverListItem) => <span className="text-text-muted text-xs">{fmt(d.created_at)}</span> },
    {
      key: 'actions', header: '',
      render: (d: DriverListItem) => (
        <button
          onClick={e => { e.stopPropagation(); router.push(`/drivers/${d.id}`) }}
          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary"
        >
          Review
        </button>
      ),
    },
  ]

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <SuccessToast message={successMsg} onDismiss={() => setSuccessMsg(null)} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Drivers"    value={total}                                                 change="All time"        changeType="neutral" icon={Users}    gradient="blue"   loading={listLoading} />
        <StatCard title="Active"           value={drivers.filter(d => d.status === 'active').length}      change="+3 this week"    changeType="up"      icon={UserCheck} gradient="green"  loading={listLoading} />
        <StatCard title="Pending Approval" value={pending.length}                                         change="Needs attention" changeType="neutral" icon={Clock}    gradient="amber"  loading={listLoading} />
        <StatCard title="Suspended"        value={drivers.filter(d => d.status === 'suspended').length}   change="Under review"    changeType="neutral" icon={ShieldOff} gradient="purple" loading={listLoading} />
      </div>

      {/* Pending approval banner */}
      {pending.length > 0 && (
        <div className="bg-warning-light border border-warning/20 rounded-2xl p-4">
          <p className="text-sm font-bold text-warning mb-3">
            ⚡ {pending.length} driver{pending.length > 1 ? 's' : ''} awaiting approval
          </p>
          <table className="data-table">
            <thead><tr><th>Driver</th><th>Phone</th><th>Vehicle</th><th>Applied</th><th>Actions</th></tr></thead>
            <tbody>
              {pending.map(d => (
                <tr key={d.id} className="group">
                  <td className="font-semibold text-text-primary">{d.full_name ?? '—'}</td>
                  <td>{d.phone}</td>
                  <td>{d.vehicle?.number_plate ?? '—'}</td>
                  <td className="text-text-muted">{fmt(d.created_at)}</td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => openAction('approve', d)} className="px-3 py-1 text-xs font-semibold bg-success text-white rounded-lg hover:bg-emerald-600 transition-colors">Approve</button>
                      <button
                        onClick={() => router.push(`/drivers/${d.id}?tab=documents`)}
                        className="px-3 py-1 text-xs font-semibold border border-primary text-primary rounded-lg hover:bg-primary-light transition-colors"
                      >
                        Review Docs
                      </button>
                      <button onClick={() => openAction('rejectDocs', d)} className="px-3 py-1 text-xs font-semibold border border-warning text-warning rounded-lg hover:bg-warning/8 transition-colors">Reject Docs</button>
                      <button onClick={() => openAction('ban', d)} className="px-3 py-1 text-xs font-semibold border border-danger text-danger rounded-lg hover:bg-danger-light transition-colors">Ban</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Main table */}
      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by name, phone, or code…"
            filters={[{
              key: 'status', label: 'All Statuses',
              options: [
                { value: 'active',           label: 'Active' },
                { value: 'pending_approval', label: 'Pending Approval' },
                { value: 'docs_rejected',    label: 'Docs Rejected' },
                { value: 'suspended',        label: 'Suspended' },
                { value: 'pending_docs',     label: 'Pending Docs' },
              ],
              value: statusFilter,
              onChange: v => { setStatusFilter(v); setPage(1) },
            }]}
          />
        </div>

        {listLoading ? (
          <table className="data-table w-full"><tbody><SkeletonRows /></tbody></table>
        ) : drivers.length === 0 ? (
          <div className="py-16 text-center"><p className="text-text-muted text-sm">No drivers match your filters</p></div>
        ) : (
          <DataTable
            columns={columns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
            data={drivers as unknown as Record<string, unknown>[]}
            onRowClick={row => router.push(`/drivers/${(row as unknown as DriverListItem).id}`)}
            emptyMessage="No drivers match your filters"
          />
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted">Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1}     onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Previous</button>
              <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Approve confirm */}
      <ConfirmDialog
        open={pendingAction?.type === 'approve'}
        onOpenChange={v => { if (!v) { setPendingAction(null); setActionError('') } }}
        title="Approve Driver"
        description={actionError || `Approve ${pendingAction?.driverName} as an active driver?`}
        confirmLabel={actionLoading ? 'Submitting…' : 'Approve'}
        variant={actionError ? 'danger' : 'success'}
        onConfirm={() => { if (!actionLoading) executeAction() }}
      />

      {/* Reject docs: recoverable, driver can fix and resubmit */}
      <ReasonDialog
        open={pendingAction?.type === 'rejectDocs'}
        title="Reject Documents"
        description={`Tell ${pendingAction?.driverName ?? ''} what needs to be fixed. They will be asked to re-upload and resubmit.`}
        confirmLabel="Reject Docs"
        variant="warning"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />

      {/* Ban: permanent */}
      <ReasonDialog
        open={pendingAction?.type === 'ban'}
        title="Ban Driver"
        description={`Permanently ban ${pendingAction?.driverName ?? ''}? This cannot be undone.`}
        confirmLabel="Ban Driver"
        variant="danger"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />
    </div>
  )
}
