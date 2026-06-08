'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Users, UserCheck, Clock, ShieldOff } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { adminDriverApi, type DriverListItem, type DriverDetail } from '@/lib/admin-api'
import { cn } from '@/lib/utils'

// ─── helpers ────────────────────────────────────────────────────────────────

function InitialsAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={cn(
      'rounded-full bg-primary-light flex items-center justify-center flex-shrink-0',
      size === 'lg' ? 'w-16 h-16' : 'w-8 h-8'
    )}>
      <span className={cn('font-bold text-primary', size === 'lg' ? 'text-xl' : 'text-xs')}>{initials}</span>
    </div>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function docLabel(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── reason dialog (reject / suspend require a typed reason) ─────────────────

interface ReasonDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  variant: 'danger' | 'warning'
  loading: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}

function ReasonDialog({ open, title, description, confirmLabel, variant, loading, onCancel, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const valid = reason.trim().length >= 10

  useEffect(() => { if (!open) setReason('') }, [open])

  const btnClass = variant === 'danger'
    ? 'bg-danger text-white hover:bg-red-600'
    : 'bg-warning text-white hover:bg-amber-600'

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[440px]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-2">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-text-secondary mb-4 leading-relaxed">{description}</Dialog.Description>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Enter reason (minimum 10 characters)…"
            rows={3}
            className="w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted mb-1"
          />
          <p className="text-xs text-text-muted mb-5">{reason.trim().length}/10 min chars</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(reason.trim())}
              disabled={!valid || loading}
              className={cn('px-4 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed', btnClass)}
            >
              {loading ? 'Submitting…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── skeleton rows ───────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-light last:border-b-0">
          {Array.from({ length: 8 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: j === 0 ? '140px' : j === 7 ? '60px' : '80px' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ─── slide-over tabs ─────────────────────────────────────────────────────────

type SlideOverTab = 'overview' | 'documents' | 'vehicle' | 'history'

const TABS: { key: SlideOverTab; label: string }[] = [
  { key: 'overview',  label: 'Overview'  },
  { key: 'documents', label: 'Documents' },
  { key: 'vehicle',   label: 'Vehicle'   },
  { key: 'history',   label: 'History'   },
]

// ─── page ────────────────────────────────────────────────────────────────────

type ActionType = 'approve' | 'reject' | 'suspend' | 'reinstate'

interface PendingAction {
  type: ActionType
  driverId: string
  driverName: string
}

const LIMIT = 20

export default function DriversPage() {
  // list state
  const [drivers, setDrivers] = useState<DriverListItem[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [listLoading, setListLoading] = useState(true)

  // filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // slide-over
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DriverDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [detailRetry, setDetailRetry] = useState(0)
  const [activeTab, setActiveTab] = useState<SlideOverTab>('overview')

  // actions
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')

  // ── debounce search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // ── fetch list ───────────────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await adminDriverApi.list({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        limit: LIMIT,
      })
      setDrivers(res.drivers)
      setTotal(res.pagination.total)
      setPages(res.pagination.pages)
    } catch {
      // keep stale data on error
    } finally {
      setListLoading(false)
    }
  }, [statusFilter, debouncedSearch, page])

  useEffect(() => { fetchList() }, [fetchList])

  // ── fetch detail when slide-over opens ───────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(false); return }
    setDetailLoading(true)
    setDetailError(false)
    setActiveTab('overview')
    adminDriverApi.getById(selectedId)
      .then(setDetail)
      .catch(() => setDetailError(true))
      .finally(() => setDetailLoading(false))
  }, [selectedId, detailRetry])

  // ── action helpers ────────────────────────────────────────────────────────
  function openAction(type: ActionType, driver: DriverListItem) {
    setPendingAction({ type, driverId: driver.id, driverName: driver.full_name ?? driver.phone })
  }

  function openActionFromDetail(type: ActionType) {
    if (!detail) return
    setPendingAction({ type, driverId: detail.id, driverName: detail.full_name ?? detail.phone })
  }

  async function executeAction(reason?: string) {
    if (!pendingAction) return
    setActionLoading(true)
    setActionError('')
    try {
      const { type, driverId } = pendingAction
      if (type === 'approve')   await adminDriverApi.approve(driverId)
      if (type === 'reject')    await adminDriverApi.reject(driverId, reason!)
      if (type === 'suspend')   await adminDriverApi.suspend(driverId, reason!)
      if (type === 'reinstate') await adminDriverApi.reinstate(driverId)

      setPendingAction(null)
      await fetchList()
      if (selectedId === driverId) {
        const updated = await adminDriverApi.getById(driverId)
        setDetail(updated)
      }
    } catch {
      setActionError('Action failed. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const pending = drivers.filter(d => d.status === 'pending_approval')

  // ── table columns ─────────────────────────────────────────────────────────
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
        <span className="text-xs text-text-secondary">{d.docs_approved}/{d.docs_submitted}</span>
      ),
    },
    { key: 'joined', header: 'Joined', render: (d: DriverListItem) => <span className="text-text-muted text-xs">{fmt(d.created_at)}</span> },
    {
      key: 'actions', header: '',
      render: (d: DriverListItem) => (
        <button
          onClick={e => { e.stopPropagation(); setSelectedId(d.id) }}
          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary"
        >
          Review
        </button>
      ),
    },
  ]

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Drivers"    value={total}                                                  change="All time"        changeType="neutral" icon={Users}    gradient="blue"   />
        <StatCard title="Active"           value={drivers.filter(d => d.status === 'active').length}       change="+3 this week"    changeType="up"      icon={UserCheck} gradient="green"  />
        <StatCard title="Pending Approval" value={pending.length}                                          change="Needs attention" changeType="neutral" icon={Clock}    gradient="amber"  />
        <StatCard title="Suspended"        value={drivers.filter(d => d.status === 'suspended').length}    change="Under review"    changeType="neutral" icon={ShieldOff} gradient="purple" />
      </div>

      {/* Pending approval banner */}
      {pending.length > 0 && (
        <div className="bg-warning-light border border-warning/20 rounded-2xl p-4">
          <p className="text-sm font-bold text-warning mb-3">
            ⚡ {pending.length} driver{pending.length > 1 ? 's' : ''} awaiting approval
          </p>
          <table className="data-table">
            <thead>
              <tr><th>Driver</th><th>Phone</th><th>Vehicle</th><th>Applied</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {pending.map(d => (
                <tr key={d.id} className="group">
                  <td className="font-semibold text-text-primary">{d.full_name ?? '—'}</td>
                  <td>{d.phone}</td>
                  <td>{d.vehicle?.number_plate ?? '—'}</td>
                  <td className="text-text-muted">{fmt(d.created_at)}</td>
                  <td>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openAction('approve', d)}
                        className="px-3 py-1 text-xs font-semibold bg-success text-white rounded-lg hover:bg-emerald-600 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => openAction('reject', d)}
                        className="px-3 py-1 text-xs font-semibold border border-danger text-danger rounded-lg hover:bg-danger-light transition-colors"
                      >
                        Reject
                      </button>
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
                { value: 'suspended',        label: 'Suspended' },
                { value: 'pending_docs',     label: 'Pending Docs' },
              ],
              value: statusFilter,
              onChange: (v) => { setStatusFilter(v); setPage(1) },
            }]}
            onExport={() => {}}
          />
        </div>

        {listLoading ? (
          <table className="data-table w-full"><tbody><SkeletonRows /></tbody></table>
        ) : drivers.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-text-muted text-sm">No drivers match your filters</p>
          </div>
        ) : (
          <DataTable
            columns={columns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
            data={drivers as unknown as Record<string, unknown>[]}
            onRowClick={row => setSelectedId((row as unknown as DriverListItem).id)}
            emptyMessage="No drivers match your filters"
          />
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= pages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Driver slide-over */}
      <SlideOver
        isOpen={!!selectedId}
        onClose={() => { setSelectedId(null); setDetail(null) }}
        title={detail?.full_name ?? detail?.phone ?? 'Driver Detail'}
        width="lg"
      >
        {detailLoading ? (
          <div className="flex flex-col gap-4 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-6 bg-surface-2 rounded animate-pulse" />
            ))}
          </div>
        ) : detailError || !detail ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 p-6">
            <p className="text-text-muted text-sm">Failed to load driver details.</p>
            <button
              onClick={() => setDetailRetry(n => n + 1)}
              className="text-xs text-primary underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 pt-6 pb-5 border-b border-border flex items-center gap-4">
              <InitialsAvatar name={detail.full_name ?? detail.phone} size="lg" />
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl font-bold text-text-primary">{detail.full_name ?? '—'}</h3>
                  <StatusPill status={detail.status} />
                </div>
                <p className="text-sm text-text-muted font-mono">{detail.code}</p>
                <p className="text-sm text-text-secondary">{detail.phone}</p>
              </div>
            </div>

            {/* Key stats */}
            <div className="px-6 pt-5 grid grid-cols-3 gap-3">
              {[
                { label: 'Documents', value: `${detail.documents.length + detail.vehicle_documents.length} uploaded` },
                { label: 'Experience', value: detail.experience_years != null ? `${detail.experience_years} yr${detail.experience_years !== 1 ? 's' : ''}` : '—' },
                { label: 'Joined', value: fmt(detail.created_at) },
              ].map(s => (
                <div key={s.label} className="bg-surface-2 rounded-xl p-3 text-center border border-border-light">
                  <p className="text-sm font-black text-text-primary">{s.value}</p>
                  <p className="text-xs text-text-muted">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Tab bar */}
            <div className="px-6 mt-4 flex gap-0 border-b border-border">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap',
                    activeTab === tab.key
                      ? 'border-b-2 border-primary text-primary'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {/* overview */}
              {activeTab === 'overview' && (
                <>
                  <div className="bg-surface-2 rounded-xl p-4 border border-border-light space-y-2">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Contact</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-text-muted">Phone</span>      <span className="text-text-primary font-medium">{detail.phone}</span>
                      <span className="text-text-muted">Email</span>      <span className="text-text-primary font-medium">{detail.email ?? '—'}</span>
                      <span className="text-text-muted">Gender</span>     <span className="text-text-primary font-medium capitalize">{detail.gender ?? '—'}</span>
                      <span className="text-text-muted">DOB</span>        <span className="text-text-primary font-medium">{detail.date_of_birth ? fmt(detail.date_of_birth) : '—'}</span>
                      <span className="text-text-muted">Address</span>    <span className="text-text-primary font-medium">{detail.residential_address ?? '—'}</span>
                      <span className="text-text-muted">City/State</span> <span className="text-text-primary font-medium">{[detail.city, detail.state].filter(Boolean).join(', ') || '—'}</span>
                      <span className="text-text-muted">Emergency</span>  <span className="text-text-primary font-medium">{detail.emergency_contact ?? '—'}</span>
                      <span className="text-text-muted">Languages</span>  <span className="text-text-primary font-medium">{detail.languages_known.join(', ') || '—'}</span>
                    </div>
                  </div>

                  <div className="bg-surface-2 rounded-xl p-4 border border-border-light space-y-2">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Identity</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-text-muted">Aadhaar</span> <span className="font-mono text-text-primary">{detail.aadhaar_number ?? '—'}</span>
                      <span className="text-text-muted">Licence</span> <span className="font-mono text-text-primary">{detail.license_number ?? '—'}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="space-y-2 pt-1">
                    {detail.status === 'pending_approval' && <>
                      <button
                        onClick={() => openActionFromDetail('approve')}
                        className="w-full py-2.5 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors"
                      >
                        Approve Driver
                      </button>
                      <button
                        onClick={() => openActionFromDetail('reject')}
                        className="w-full py-2.5 border border-danger text-danger font-semibold rounded-xl text-sm hover:bg-danger-light transition-colors"
                      >
                        Reject Application
                      </button>
                    </>}
                    {detail.status === 'active' && (
                      <button
                        onClick={() => openActionFromDetail('suspend')}
                        className="w-full py-2.5 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning-light transition-colors"
                      >
                        Suspend Driver
                      </button>
                    )}
                    {detail.status === 'suspended' && (
                      <button
                        onClick={() => openActionFromDetail('reinstate')}
                        className="w-full py-2.5 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors"
                      >
                        Reinstate Driver
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* documents */}
              {activeTab === 'documents' && (
                <div className="space-y-3">
                  {detail.documents.length === 0 && detail.vehicle_documents.length === 0 && (
                    <p className="text-sm text-text-muted text-center py-8">No documents uploaded yet</p>
                  )}
                  {detail.documents.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Driver Documents</p>
                      {detail.documents.map(doc => (
                        <div key={doc.doc_type} className="flex items-center justify-between bg-surface-2 rounded-xl px-4 py-3 border border-border-light">
                          <div>
                            <p className="text-sm font-medium text-text-primary">{docLabel(doc.doc_type)}</p>
                            {doc.rejection_note && <p className="text-xs text-danger mt-0.5">{doc.rejection_note}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={doc.status} />
                            <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline hover:no-underline">View</a>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  {detail.vehicle_documents.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mt-2">Vehicle Documents</p>
                      {detail.vehicle_documents.map(doc => (
                        <div key={doc.doc_type} className="flex items-center justify-between bg-surface-2 rounded-xl px-4 py-3 border border-border-light">
                          <div>
                            <p className="text-sm font-medium text-text-primary">{docLabel(doc.doc_type)}</p>
                            {doc.rejection_note && <p className="text-xs text-danger mt-0.5">{doc.rejection_note}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={doc.status} />
                            <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline hover:no-underline">View</a>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* vehicle */}
              {activeTab === 'vehicle' && (
                <div className="space-y-3">
                  {!detail.vehicle ? (
                    <p className="text-sm text-text-muted text-center py-8">No vehicle registered yet</p>
                  ) : (
                    <div className="bg-surface-2 rounded-xl p-4 border border-border-light space-y-2">
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Vehicle Details</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        <span className="text-text-muted">Name</span>     <span className="font-medium text-text-primary">{detail.vehicle.vehicle_name}</span>
                        <span className="text-text-muted">Brand</span>    <span className="font-medium text-text-primary">{detail.vehicle.brand}</span>
                        <span className="text-text-muted">Plate</span>    <span className="font-mono font-bold text-text-primary">{detail.vehicle.number_plate}</span>
                        <span className="text-text-muted">Category</span> <span className="font-medium text-text-primary">{detail.vehicle.category}</span>
                        <span className="text-text-muted">Year</span>     <span className="font-medium text-text-primary">{detail.vehicle.model_year}</span>
                        <span className="text-text-muted">Color</span>    <span className="font-medium text-text-primary capitalize">{detail.vehicle.color}</span>
                        <span className="text-text-muted">Fuel</span>     <span className="font-medium text-text-primary capitalize">{detail.vehicle.fuel_type}</span>
                        <span className="text-text-muted">Seats</span>    <span className="font-medium text-text-primary">{detail.vehicle.seating_capacity}</span>
                        <span className="text-text-muted">AC</span>       <span className="font-medium text-text-primary">{detail.vehicle.ac_availability ? 'Yes' : 'No'}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* history */}
              {activeTab === 'history' && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Status History</p>
                  {detail.status_history.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-8">No status changes recorded</p>
                  ) : detail.status_history.map((h, i) => (
                    <div key={i} className="bg-surface-2 rounded-xl px-4 py-3 border border-border-light">
                      <div className="flex items-center gap-2 mb-1">
                        {h.from_status && <StatusPill status={h.from_status} />}
                        {h.from_status && <span className="text-xs text-text-muted">→</span>}
                        <StatusPill status={h.to_status} />
                      </div>
                      {h.reason && <p className="text-xs text-text-secondary mt-1">{h.reason}</p>}
                      <p className="text-xs text-text-muted mt-1">{fmt(h.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SlideOver>

      {/* Approve / Reinstate — no reason required */}
      <ConfirmDialog
        open={pendingAction?.type === 'approve' || pendingAction?.type === 'reinstate'}
        onOpenChange={v => { if (!v) { setPendingAction(null); setActionError('') } }}
        title={pendingAction?.type === 'approve' ? 'Approve Driver' : 'Reinstate Driver'}
        description={
          actionError
            ? actionError
            : pendingAction?.type === 'approve'
              ? `Approve ${pendingAction?.driverName} as an active driver?`
              : `Reinstate ${pendingAction?.driverName} as an active driver?`
        }
        confirmLabel={actionLoading ? 'Submitting…' : pendingAction?.type === 'approve' ? 'Approve' : 'Reinstate'}
        variant={actionError ? 'danger' : 'success'}
        onConfirm={() => { if (!actionLoading) executeAction() }}
      />

      {/* Reject — reason required */}
      <ReasonDialog
        open={pendingAction?.type === 'reject'}
        title="Reject Application"
        description={`Reject ${pendingAction?.driverName ?? ''}'s driver application? Please provide a reason.`}
        confirmLabel="Reject Application"
        variant="danger"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />

      {/* Suspend — reason required */}
      <ReasonDialog
        open={pendingAction?.type === 'suspend'}
        title="Suspend Driver"
        description={`Suspend ${pendingAction?.driverName ?? ''}? They will not be able to accept rides. Please provide a reason.`}
        confirmLabel="Suspend Driver"
        variant="warning"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />
    </div>
  )
}
