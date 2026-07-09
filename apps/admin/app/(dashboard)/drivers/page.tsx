'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Users, UserCheck, Clock, ShieldOff, X,
  FileText, CheckCircle, XCircle, AlertCircle, Layers,
} from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DocReviewModal from '@/components/ui/DocReviewModal'
import { adminDriverApi, type DriverListItem, type DriverDetail } from '@/lib/admin-api'
import { cn } from '@/lib/utils'

// ─── helpers ─────────────────────────────────────────────────────────────────

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

const DOC_LABELS: Record<string, string> = {
  profile_photo: 'Profile Photo', driving_license: 'Driving Licence',
  driving_license_front: 'Driving Licence (Front)', driving_license_back: 'Driving Licence (Back)',
  aadhaar_front: 'Aadhaar (Front)', aadhaar_back: 'Aadhaar (Back)',
  vehicle_rc: 'RC Book', insurance: 'Insurance Certificate', permit: 'Commercial Permit',
  pollution_cert: 'Pollution Certificate (PUC)', fitness_cert: 'Fitness Certificate',
}
function docLabel(key: string) {
  return DOC_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const REQUIRED_DRIVER_DOCS  = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
const REQUIRED_VEHICLE_DOCS = ['vehicle_rc', 'insurance', 'permit']

// ─── ReasonDialog (for list-level actions only) ───────────────────────────────

interface ReasonDialogProps {
  open: boolean; title: string; description: string
  confirmLabel: string; variant: 'danger' | 'warning'
  loading: boolean; onCancel: () => void; onConfirm: (r: string) => void
}
function ReasonDialog({ open, title, description, confirmLabel, variant, loading, onCancel, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const valid = reason.trim().length >= 10
  useEffect(() => { if (!open) setReason('') }, [open])
  const btnCls = variant === 'danger'
    ? 'bg-danger text-white hover:bg-red-600'
    : 'bg-warning text-white hover:bg-amber-600'
  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[440px]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-2">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-text-secondary mb-4 leading-relaxed">{description}</Dialog.Description>
          <textarea
            value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Enter reason (minimum 10 characters)…" rows={3}
            className="w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted mb-1"
          />
          <p className="text-xs text-text-muted mb-5">{reason.trim().length}/10 min chars</p>
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors">Cancel</button>
            <button
              onClick={() => onConfirm(reason.trim())}
              disabled={!valid || loading}
              className={cn('px-4 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50', btnCls)}
            >
              {loading ? 'Submitting…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

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

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type SlideOverTab = 'overview' | 'documents' | 'vehicle' | 'history'
const TABS: { key: SlideOverTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'documents', label: 'Documents' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'history', label: 'History' },
]

// ─── Doc checklist item (inside Documents tab) ────────────────────────────────

function DocCheckItem({
  docType, fileUrl, status, rejectionNote, onClick,
}: { docType: string; fileUrl: string | null; status: string; rejectionNote?: string | null; onClick: () => void }) {
  const isMissing = !fileUrl || status === 'missing'
  const isPdf = fileUrl && /\.pdf(\?|$)/i.test(fileUrl)

  return (
    <button
      onClick={onClick}
      disabled={isMissing}
      className={cn(
        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left group',
        isMissing
          ? 'border-dashed border-border bg-surface-2/50 cursor-default'
          : 'border-border bg-surface-2 hover:border-primary/30 hover:bg-primary/3 cursor-pointer'
      )}
    >
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-3">
        {isMissing ? (
          <div className="w-full h-full flex items-center justify-center"><FileText size={15} className="text-text-muted" /></div>
        ) : isPdf ? (
          <div className="w-full h-full flex items-center justify-center bg-red-50"><FileText size={15} className="text-red-400" /></div>
        ) : (
          <img src={fileUrl!} alt={docLabel(docType)} className="w-full h-full object-cover" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-text-primary truncate">{docLabel(docType)}</p>
        {rejectionNote && status === 'rejected'
          ? <p className="text-[10px] text-danger mt-0.5 truncate">{rejectionNote}</p>
          : <p className={cn('text-[10px] mt-0.5 capitalize',
              status === 'approved' ? 'text-success' : status === 'rejected' ? 'text-danger' : status === 'pending' ? 'text-warning' : 'text-text-muted'
            )}>
              {isMissing ? 'Not uploaded' : status}
            </p>
        }
      </div>

      {/* Status icon */}
      {status === 'approved' && <CheckCircle size={15} className="text-success flex-shrink-0" />}
      {status === 'rejected' && <XCircle     size={15} className="text-danger  flex-shrink-0" />}
      {status === 'pending' && fileUrl && <AlertCircle size={15} className="text-warning flex-shrink-0" />}
      {isMissing && <AlertCircle size={15} className="text-text-muted flex-shrink-0" />}

      {!isMissing && (
        <span className="text-[10px] font-semibold text-text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          View →
        </span>
      )}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type ActionType = 'approve' | 'rejectDocs' | 'ban' | 'suspend' | 'reinstate'
interface PendingAction { type: ActionType; driverId: string; driverName: string }
const LIMIT = 20

export default function DriversPage() {
  const [drivers, setDrivers]             = useState<DriverListItem[]>([])
  const [total, setTotal]                 = useState(0)
  const [pages, setPages]                 = useState(1)
  const [page, setPage]                   = useState(1)
  const [listLoading, setListLoading]     = useState(true)

  const [search, setSearch]                       = useState('')
  const [statusFilter, setStatusFilter]           = useState('')
  const debounceRef                               = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch]     = useState('')

  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [detail, setDetail]               = useState<DriverDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError]     = useState(false)
  const [detailRetry, setDetailRetry]     = useState(0)
  const [activeTab, setActiveTab]         = useState<SlideOverTab>('overview')

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError]     = useState('')

  // Doc review modal
  const [reviewOpen, setReviewOpen]       = useState(false)
  const [reviewInitIdx, setReviewInitIdx] = useState(0)
  const [bannerLoadingId, setBannerLoadingId] = useState<string | null>(null)

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

  // ── fetch detail ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(false); return }
    setDetailLoading(true); setDetailError(false); setActiveTab('overview')
    adminDriverApi.getById(selectedId)
      .then(setDetail).catch(() => setDetailError(true)).finally(() => setDetailLoading(false))
  }, [selectedId, detailRetry])

  // ── open doc review modal ──────────────────────────────────────────────────
  function openReview(initDocIdx = 0) {
    setReviewInitIdx(initDocIdx)
    setReviewOpen(true)
  }

  // ── list-level driver actions ──────────────────────────────────────────────
  function openAction(type: ActionType, driver: DriverListItem) {
    setPendingAction({ type, driverId: driver.id, driverName: driver.full_name ?? driver.phone })
  }
  function openActionFromDetail(type: ActionType) {
    if (!detail) return
    setPendingAction({ type, driverId: detail.id, driverName: detail.full_name ?? detail.phone })
  }
  async function executeAction(reason?: string) {
    if (!pendingAction) return
    setActionLoading(true); setActionError('')
    try {
      const { type, driverId } = pendingAction
      if (type === 'approve')     await adminDriverApi.approve(driverId)
      if (type === 'rejectDocs')  await adminDriverApi.rejectDocs(driverId, reason!)
      if (type === 'ban')         await adminDriverApi.ban(driverId, reason!)
      if (type === 'suspend')     await adminDriverApi.suspend(driverId, reason!)
      if (type === 'reinstate')   await adminDriverApi.reinstate(driverId)
      setPendingAction(null)
      await fetchList()
      if (selectedId === driverId) {
        const updated = await adminDriverApi.getById(driverId)
        setDetail(updated)
      }
    } catch { setActionError('Action failed. Please try again.') }
    finally { setActionLoading(false) }
  }

  // ── modal driver action (inline form, closes modal) ───────────────────────
  async function handleModalDriverAction(
    type: 'approve' | 'rejectDocs' | 'ban' | 'suspend' | 'reinstate',
    reason?: string
  ) {
    if (!detail) return
    if (type === 'approve')     await adminDriverApi.approve(detail.id)
    if (type === 'rejectDocs')  await adminDriverApi.rejectDocs(detail.id, reason!)
    if (type === 'ban')         await adminDriverApi.ban(detail.id, reason!)
    if (type === 'suspend')     await adminDriverApi.suspend(detail.id, reason!)
    if (type === 'reinstate')   await adminDriverApi.reinstate(detail.id)
    setReviewOpen(false)
    setSelectedId(null)
    setDetail(null)
    await fetchList()
  }

  // ── modal doc actions ──────────────────────────────────────────────────────
  async function handleDriverDocApprove(docId: string) {
    await adminDriverApi.approveDriverDoc(docId)
    if (detail) { const updated = await adminDriverApi.getById(detail.id); setDetail(updated) }
  }
  async function handleDriverDocReject(docId: string, reason: string) {
    await adminDriverApi.rejectDriverDoc(docId, reason)
    if (detail) { const updated = await adminDriverApi.getById(detail.id); setDetail(updated) }
  }
  async function handleVehicleDocApprove(docId: string) {
    await adminDriverApi.approveVehicleDoc(docId)
    if (detail) { const updated = await adminDriverApi.getById(detail.id); setDetail(updated) }
  }
  async function handleVehicleDocReject(docId: string, reason: string) {
    await adminDriverApi.rejectVehicleDoc(docId, reason)
    if (detail) { const updated = await adminDriverApi.getById(detail.id); setDetail(updated) }
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
          onClick={e => { e.stopPropagation(); setSelectedId(d.id) }}
          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary"
        >
          Review
        </button>
      ),
    },
  ]

  // ── Documents tab ──────────────────────────────────────────────────────────
  function DocumentsTab({ d }: { d: DriverDetail }) {
    const allDocs = [
      ...d.documents.map(x => ({ ...x, kind: 'driver' as const })),
      ...d.vehicle_documents.map(x => ({ ...x, kind: 'vehicle' as const })),
    ]
    const flatForModal = allDocs // same order as modal's buildDocs for uploaded docs

    // Missing
    const missingDriver  = REQUIRED_DRIVER_DOCS.filter(k => !d.documents.find(x => x.doc_type === k))
    const missingVehicle = REQUIRED_VEHICLE_DOCS.filter(k => !d.vehicle_documents.find(x => x.doc_type === k))
    const totalMissing   = missingDriver.length + missingVehicle.length

    // Selfie
    const selfie = d.documents.find(x => x.doc_type === 'profile_photo')

    // Find index in the flat modal list
    function docIdx(docType: string) {
      // Modal buildDocs: uploaded driver docs first, then uploaded vehicle docs, then missing stubs
      const idx = flatForModal.findIndex(x => x.doc_type === docType)
      return idx >= 0 ? idx : 0
    }

    return (
      <div className="space-y-4">
        {/* Identity anchor */}
        <div className="bg-surface-2 rounded-2xl border border-border-light p-4 flex items-center gap-4">
          <button
            onClick={() => openReview(docIdx('profile_photo'))}
            disabled={!selfie}
            className={cn('relative group flex-shrink-0', !selfie && 'cursor-default')}
            aria-label="View selfie"
          >
            {selfie ? (
              <>
                <img src={selfie.file_url} alt="Selfie" className="w-16 h-16 rounded-full object-cover border-2 border-border" />
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">View</span>
                </div>
              </>
            ) : (
              <div className="w-16 h-16 rounded-full bg-surface-3 border-2 border-dashed border-border flex items-center justify-center">
                <span className="text-text-muted text-[10px] text-center px-1">No selfie</span>
              </div>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary">{d.full_name ?? d.phone}</p>
            <div className="mt-1 space-y-0.5 text-xs">
              <div className="flex gap-2">
                <span className="text-text-muted w-14">Aadhaar</span>
                {d.aadhaar_number
                  ? <span className="font-mono text-text-secondary">{d.aadhaar_number}</span>
                  : <span className="text-danger font-medium">Not provided</span>}
              </div>
              <div className="flex gap-2">
                <span className="text-text-muted w-14">Licence</span>
                {d.license_number
                  ? <span className="font-mono text-text-secondary">{d.license_number}</span>
                  : <span className="text-danger font-medium">Not provided</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Missing docs warning */}
        {totalMissing > 0 && (
          <div className="bg-danger/5 border border-danger/20 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-danger mb-0.5">{totalMissing} required document{totalMissing !== 1 ? 's' : ''} missing</p>
              <p className="text-xs text-danger/75">{[...missingDriver, ...missingVehicle].map(k => docLabel(k)).join(' · ')}</p>
            </div>
          </div>
        )}

        {/* Driver docs checklist */}
        {d.documents.filter(x => x.doc_type !== 'profile_photo').length > 0 && (
          <div>
            <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2">Identity Documents</p>
            <div className="space-y-1.5">
              {d.documents.filter(x => x.doc_type !== 'profile_photo').map((doc, i) => (
                <DocCheckItem
                  key={doc.doc_type}
                  docType={doc.doc_type}
                  fileUrl={doc.file_url}
                  status={doc.status}
                  rejectionNote={doc.rejection_note}
                  onClick={() => openReview(docIdx(doc.doc_type))}
                />
              ))}
            </div>
          </div>
        )}

        {/* Vehicle docs checklist */}
        {(d.vehicle_documents.length > 0 || missingVehicle.length > 0) && (
          <div>
            <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2">Vehicle Documents</p>
            <div className="space-y-1.5">
              {d.vehicle_documents.map(doc => (
                <DocCheckItem
                  key={doc.doc_type}
                  docType={doc.doc_type}
                  fileUrl={doc.file_url}
                  status={doc.status}
                  rejectionNote={doc.rejection_note}
                  onClick={() => openReview(docIdx(doc.doc_type))}
                />
              ))}
              {missingVehicle.map(key => (
                <DocCheckItem key={key} docType={key} fileUrl={null} status="missing" onClick={() => {}} />
              ))}
            </div>
          </div>
        )}

        {/* Review documents CTA */}
        {allDocs.length > 0 && (
          <button
            onClick={() => openReview(0)}
            className="w-full py-3 bg-primary text-white font-bold text-sm rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Layers size={15} />
            Review All Documents
          </button>
        )}

        {/* Application decision */}
        {(d.status === 'pending_approval' || d.status === 'docs_rejected' || d.status === 'active' || d.status === 'suspended') && (
          <div className="pt-1 border-t border-border space-y-2">
            <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 pt-1">Application Decision</p>
            {d.status === 'pending_approval' && (
              <>
                {totalMissing > 0 && (
                  <p className="text-xs text-warning bg-warning/8 border border-warning/20 rounded-lg px-3 py-2">
                    {totalMissing} doc{totalMissing !== 1 ? 's' : ''} missing. Approve anyway to activate.
                  </p>
                )}
                <button onClick={() => openActionFromDetail('approve')}    className="w-full py-2.5 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">Approve Driver</button>
                <button onClick={() => openActionFromDetail('rejectDocs')} className="w-full py-2.5 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning/6 transition-colors">Reject Docs (Fix & Resubmit)</button>
                <button onClick={() => openActionFromDetail('ban')}        className="w-full py-2.5 border border-danger text-danger font-semibold rounded-xl text-sm hover:bg-danger/6 transition-colors">Ban Driver</button>
              </>
            )}
            {d.status === 'docs_rejected' && (
              <>
                <p className="text-xs text-warning bg-warning/8 border border-warning/20 rounded-lg px-3 py-2">Driver notified to fix documents and resubmit.</p>
                <button onClick={() => openActionFromDetail('ban')} className="w-full py-2.5 border border-danger text-danger font-semibold rounded-xl text-sm hover:bg-danger/6 transition-colors">Ban Driver</button>
              </>
            )}
            {d.status === 'active' && (
              <button onClick={() => openActionFromDetail('suspend')} className="w-full py-2.5 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning/6 transition-colors">Suspend Driver</button>
            )}
            {d.status === 'suspended' && (
              <button onClick={() => openActionFromDetail('reinstate')} className="w-full py-2.5 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">Reinstate Driver</button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Drivers"    value={total}                                                 change="All time"        changeType="neutral" icon={Users}    gradient="blue"   />
        <StatCard title="Active"           value={drivers.filter(d => d.status === 'active').length}      change="+3 this week"    changeType="up"      icon={UserCheck} gradient="green"  />
        <StatCard title="Pending Approval" value={pending.length}                                         change="Needs attention" changeType="neutral" icon={Clock}    gradient="amber"  />
        <StatCard title="Suspended"        value={drivers.filter(d => d.status === 'suspended').length}   change="Under review"    changeType="neutral" icon={ShieldOff} gradient="purple" />
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
                        onClick={async () => {
                          setBannerLoadingId(d.id)
                          try {
                            const fresh = await adminDriverApi.getById(d.id)
                            setDetail(fresh)
                            setReviewInitIdx(0)
                            setReviewOpen(true)
                          } finally {
                            setBannerLoadingId(null)
                          }
                        }}
                        disabled={bannerLoadingId === d.id}
                        className="px-3 py-1 text-xs font-semibold border border-primary text-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50"
                      >
                        {bannerLoadingId === d.id ? 'Loading…' : 'Review Docs'}
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
            onExport={() => {}}
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
            onRowClick={row => setSelectedId((row as unknown as DriverListItem).id)}
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

      {/* Driver slide-over */}
      <SlideOver
        isOpen={!!selectedId}
        onClose={() => { setSelectedId(null); setDetail(null); setReviewOpen(false) }}
        title={detail?.full_name ?? detail?.phone ?? 'Driver Detail'}
        width="lg"
      >
        {detailLoading ? (
          <div className="flex flex-col gap-4 p-6">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 bg-surface-2 rounded animate-pulse" />)}</div>
        ) : detailError || !detail ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 p-6">
            <p className="text-text-muted text-sm">Failed to load driver details.</p>
            <button onClick={() => setDetailRetry(n => n + 1)} className="text-xs text-primary underline">Retry</button>
          </div>
        ) : (
          <div>
            {/* Driver header */}
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
            <div className="px-6 mt-4 flex border-b border-border">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap',
                    activeTab === tab.key ? 'border-b-2 border-primary text-primary' : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  {tab.label}
                  {tab.key === 'documents' && (detail.documents.length + detail.vehicle_documents.length) > 0 && (
                    <span className={cn(
                      'ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                      detail.status === 'pending_approval' ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-text-muted'
                    )}>
                      {detail.documents.length + detail.vehicle_documents.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="px-6 py-5 space-y-4">
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
                  <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Identity</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-text-muted">Aadhaar</span> <span className="font-mono text-text-primary">{detail.aadhaar_number ?? '—'}</span>
                      <span className="text-text-muted">Licence</span> <span className="font-mono text-text-primary">{detail.license_number ?? '—'}</span>
                    </div>
                  </div>
                  <div className="space-y-2 pt-1">
                    {detail.status === 'pending_approval' && <>
                      <button onClick={() => openActionFromDetail('approve')}     className="w-full py-2.5 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">Approve Driver</button>
                      <button onClick={() => openActionFromDetail('rejectDocs')}  className="w-full py-2.5 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning/6 transition-colors">Reject Docs (Fix & Resubmit)</button>
                      <button onClick={() => openActionFromDetail('ban')}         className="w-full py-2.5 border border-danger text-danger font-semibold rounded-xl text-sm hover:bg-danger/6 transition-colors">Ban Driver</button>
                    </>}
                    {detail.status === 'docs_rejected' && <>
                      <p className="text-xs text-warning bg-warning/8 border border-warning/20 rounded-lg px-3 py-2">Driver has been notified to fix and resubmit their documents.</p>
                      <button onClick={() => openActionFromDetail('ban')} className="w-full py-2.5 border border-danger text-danger font-semibold rounded-xl text-sm hover:bg-danger/6 transition-colors">Ban Driver</button>
                    </>}
                    {detail.status === 'active' && (
                      <button onClick={() => openActionFromDetail('suspend')} className="w-full py-2.5 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning/6 transition-colors">Suspend Driver</button>
                    )}
                    {detail.status === 'suspended' && (
                      <button onClick={() => openActionFromDetail('reinstate')} className="w-full py-2.5 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">Reinstate Driver</button>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'documents' && <DocumentsTab d={detail} />}

              {activeTab === 'vehicle' && (
                <div>
                  {!detail.vehicle ? (
                    <p className="text-sm text-text-muted text-center py-8">No vehicle registered yet</p>
                  ) : (
                    <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
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

              {activeTab === 'history' && (
                <div>
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Status History</p>
                  {detail.status_history.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-8">No status changes recorded</p>
                  ) : detail.status_history.map((h, i) => (
                    <div key={i} className="bg-surface-2 rounded-xl px-4 py-3 border border-border-light mb-2">
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

      {/* Approve / Reinstate confirm */}
      <ConfirmDialog
        open={pendingAction?.type === 'approve' || pendingAction?.type === 'reinstate'}
        onOpenChange={v => { if (!v) { setPendingAction(null); setActionError('') } }}
        title={pendingAction?.type === 'approve' ? 'Approve Driver' : 'Reinstate Driver'}
        description={actionError || (pendingAction?.type === 'approve' ? `Approve ${pendingAction?.driverName} as an active driver?` : `Reinstate ${pendingAction?.driverName}?`)}
        confirmLabel={actionLoading ? 'Submitting…' : pendingAction?.type === 'approve' ? 'Approve' : 'Reinstate'}
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

      {/* Suspend */}
      <ReasonDialog
        open={pendingAction?.type === 'suspend'}
        title="Suspend Driver"
        description={`Suspend ${pendingAction?.driverName ?? ''}? They will not be able to accept rides.`}
        confirmLabel="Suspend Driver"
        variant="warning"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />

      {/* Doc review modal: portal-rendered, z-[80], always above slide-over */}
      {reviewOpen && detail && (
        <DocReviewModal
          detail={detail}
          initialDocIndex={reviewInitIdx}
          onClose={() => setReviewOpen(false)}
          onDriverAction={handleModalDriverAction}
          onDriverDocApprove={handleDriverDocApprove}
          onDriverDocReject={handleDriverDocReject}
          onVehicleDocApprove={handleVehicleDocApprove}
          onVehicleDocReject={handleVehicleDocReject}
        />
      )}
    </div>
  )
}
