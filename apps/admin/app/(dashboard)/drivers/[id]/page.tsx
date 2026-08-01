'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Pencil, Layers, AlertCircle, AlertTriangle } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ReasonDialog from '@/components/ui/ReasonDialog'
import DocReviewModal from '@/components/ui/DocReviewModal'
import {
  adminDriverApi, type DriverDetail, type DriverPaymentRow, type DriverAuditLogEntry,
} from '@/lib/admin-api'
import { vehicleCategoryApi, vehicleBrandApi, vehicleModelApi, type VehicleCategory, type VehicleBrand, type VehicleModel } from '@/lib/vehicle-api'
import { payoutsApi } from '@/lib/payouts-api'
import { cn } from '@/lib/utils'
import {
  InitialsAvatar, fmt, docLabel, REQUIRED_DRIVER_DOCS, REQUIRED_VEHICLE_DOCS, DocCheckItem,
} from '../shared'

type Tab = 'overview' | 'documents' | 'vehicle' | 'activity' | 'rides' | 'earnings' | 'history'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview',   label: 'Overview' },
  { key: 'documents',  label: 'Documents' },
  { key: 'vehicle',    label: 'Vehicle' },
  { key: 'activity',   label: 'Activity' },
  { key: 'rides',      label: 'Rides' },
  { key: 'earnings',   label: 'Earnings' },
  { key: 'history',    label: 'History' },
]

type ActionType = 'approve' | 'rejectDocs' | 'ban' | 'suspend' | 'reinstate'
type Pagination = { total: number; page: number; limit: number; pages: number }

// ── Alert strip: surface anomalies without opening a tab ──────────────────────
function AlertStrip({ d }: { d: DriverDetail }) {
  const missingDriver  = REQUIRED_DRIVER_DOCS.filter(k => !d.documents.find(x => x.doc_type === k))
  const missingVehicle = REQUIRED_VEHICLE_DOCS.filter(k => !d.vehicle_documents.find(x => x.doc_type === k))
  const totalMissing   = missingDriver.length + missingVehicle.length
  const unacknowledged = d.warnings.filter(w => !w.acknowledged_at).length
  const balance = d.wallet ? parseFloat(d.wallet.balance) : 0

  const alerts: { text: string; tone: 'danger' | 'warning' }[] = []
  if (d.wallet?.is_frozen) alerts.push({ text: 'Wallet is frozen', tone: 'danger' })
  else if (balance < 500) alerts.push({ text: `Wallet below ₹500 minimum (₹${balance.toLocaleString('en-IN')})`, tone: 'warning' })
  if (d.status === 'docs_rejected') alerts.push({ text: 'Documents were rejected — awaiting resubmission', tone: 'warning' })
  if (totalMissing > 0) alerts.push({ text: `${totalMissing} required document${totalMissing !== 1 ? 's' : ''} missing`, tone: 'warning' })
  if (unacknowledged > 0) alerts.push({ text: `${unacknowledged} unacknowledged warning${unacknowledged !== 1 ? 's' : ''}`, tone: 'danger' })
  if (d.total_ratings > 0 && parseFloat(d.rating_avg) < 3.5) alerts.push({ text: `Low rating (★ ${parseFloat(d.rating_avg).toFixed(2)})`, tone: 'warning' })

  if (alerts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {alerts.map((a, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
            a.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'
          )}
        >
          <AlertTriangle size={12} />
          {a.text}
        </span>
      ))}
    </div>
  )
}

function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): { field: string; from: unknown; to: unknown }[] {
  if (!before || !after) return []
  const diffs: { field: string; from: unknown; to: unknown }[] = []
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      diffs.push({ field: key, from: before[key], to: after[key] })
    }
  }
  return diffs
}

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>()
  const driverId = params.id
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = (searchParams.get('tab') as Tab) || 'overview'

  function setActiveTab(tab: Tab) {
    router.push(`/drivers/${driverId}?tab=${tab}`)
  }

  const [detail, setDetail]   = useState<DriverDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  const [pendingAction, setPendingAction] = useState<ActionType | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError]     = useState('')

  const [reviewOpen, setReviewOpen]       = useState(false)
  const [reviewInitIdx, setReviewInitIdx] = useState(0)

  // Identity correction (name/Aadhaar/licence typos vs. the real documents)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [identityForm, setIdentityForm] = useState({ full_name: '', aadhaar_number: '', license_number: '', reason: '' })
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [identityError, setIdentityError]   = useState('')

  // Vehicle correction (wrong category/plate/etc. from onboarding)
  const [editingVehicle, setEditingVehicle] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({
    category_id: '', brand_id: '', model_id: '', vehicle_name: '', number_plate: '',
    model_year: '', color: '', fuel_type: '', seating_capacity: '', luggage_capacity: '',
    ac_availability: true, reason: '',
  })
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [vehicleError, setVehicleError]   = useState('')
  const [vehicleCategories, setVehicleCategories] = useState<VehicleCategory[]>([])
  const [vehicleBrands, setVehicleBrands]         = useState<VehicleBrand[]>([])
  const [vehicleModels, setVehicleModels]         = useState<VehicleModel[]>([])

  // Rides tab (lazy, paginated)
  const [ridesPage, setRidesPage] = useState(1)
  const [rides, setRides] = useState<DriverDetail['recent_rides']>([])
  const [ridesPagination, setRidesPagination] = useState<Pagination | null>(null)
  const [ridesLoading, setRidesLoading] = useState(false)

  // Earnings tab (lazy, paginated) + payout controls
  const [paymentsPage, setPaymentsPage] = useState(1)
  const [payments, setPayments] = useState<DriverPaymentRow[]>([])
  const [paymentsPagination, setPaymentsPagination] = useState<Pagination | null>(null)
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [holdDialogOpen, setHoldDialogOpen] = useState(false)
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false)
  const [payoutActionLoading, setPayoutActionLoading] = useState(false)
  const [payoutError, setPayoutError] = useState('')
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')

  // History tab (lazy, paginated audit trail)
  const [auditPage, setAuditPage] = useState(1)
  const [auditEntries, setAuditEntries] = useState<DriverAuditLogEntry[]>([])
  const [auditPagination, setAuditPagination] = useState<Pagination | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      setDetail(await adminDriverApi.getById(driverId))
    } catch { setError(true) }
    finally { setLoading(false) }
  }, [driverId])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  useEffect(() => {
    if (activeTab !== 'rides') return
    setRidesLoading(true)
    adminDriverApi.rides(driverId, ridesPage)
      .then(res => { setRides(res.rides); setRidesPagination(res.pagination) })
      .finally(() => setRidesLoading(false))
  }, [activeTab, driverId, ridesPage])

  useEffect(() => {
    if (activeTab !== 'earnings') return
    setPaymentsLoading(true)
    adminDriverApi.payments(driverId, paymentsPage)
      .then(res => { setPayments(res.payments); setPaymentsPagination(res.pagination) })
      .finally(() => setPaymentsLoading(false))
  }, [activeTab, driverId, paymentsPage])

  useEffect(() => {
    if (activeTab !== 'history') return
    setAuditLoading(true)
    adminDriverApi.auditLog(driverId, auditPage)
      .then(res => { setAuditEntries(res.entries); setAuditPagination(res.pagination) })
      .finally(() => setAuditLoading(false))
  }, [activeTab, driverId, auditPage])

  function startEditIdentity() {
    if (!detail) return
    setIdentityForm({
      full_name: detail.full_name ?? '',
      // aadhaar_number is masked by the API (XXXX-XXXX-1234) — left blank so
      // saving without touching it can't overwrite the real number with the
      // mask. Blank means "leave unchanged"; the masked value shows as a
      // placeholder so the admin knows what's on file.
      aadhaar_number: '',
      license_number: detail.license_number ?? '',
      reason: '',
    })
    setIdentityError('')
    setEditingIdentity(true)
  }
  async function saveIdentity() {
    if (!detail) return
    if (identityForm.reason.trim().length < 10) {
      setIdentityError('A reason (at least 10 characters) is required.')
      return
    }
    setSavingIdentity(true); setIdentityError('')
    try {
      const fields: Parameters<typeof adminDriverApi.updateProfile>[1] = {
        full_name: identityForm.full_name,
        license_number: identityForm.license_number,
      }
      if (identityForm.aadhaar_number.trim() !== '') fields.aadhaar_number = identityForm.aadhaar_number.trim()
      await adminDriverApi.updateProfile(detail.id, fields, identityForm.reason.trim())
      await fetchDetail()
      setEditingIdentity(false)
    } catch { setIdentityError('Could not save changes. Please try again.') }
    finally { setSavingIdentity(false) }
  }

  function startEditVehicle() {
    if (!detail?.vehicle) return
    const v = detail.vehicle
    setVehicleForm({
      category_id: v.category_id ?? '', brand_id: v.brand_id ?? '', model_id: v.model_id ?? '',
      vehicle_name: v.vehicle_name, number_plate: v.number_plate, model_year: String(v.model_year),
      color: v.color, fuel_type: v.fuel_type, seating_capacity: String(v.seating_capacity),
      luggage_capacity: String(v.luggage_capacity), ac_availability: v.ac_availability, reason: '',
    })
    setVehicleError('')
    setEditingVehicle(true)
    if (vehicleCategories.length === 0) vehicleCategoryApi.list().then(setVehicleCategories).catch(() => setVehicleError('Could not load vehicle options. Try closing and reopening this form.'))
    if (vehicleBrands.length === 0) vehicleBrandApi.list().then(setVehicleBrands).catch(() => setVehicleError('Could not load vehicle options. Try closing and reopening this form.'))
    if (vehicleModels.length === 0) vehicleModelApi.list().then(setVehicleModels).catch(() => setVehicleError('Could not load vehicle options. Try closing and reopening this form.'))
  }
  async function saveVehicle() {
    if (!detail) return
    if (vehicleForm.reason.trim().length < 10) {
      setVehicleError('A reason (at least 10 characters) is required.')
      return
    }
    const modelYear = Number(vehicleForm.model_year)
    const seatingCapacity = Number(vehicleForm.seating_capacity)
    const luggageCapacity = Number(vehicleForm.luggage_capacity)
    if (
      vehicleForm.model_year.trim() === '' || !(modelYear > 0) ||
      vehicleForm.seating_capacity.trim() === '' || !(seatingCapacity > 0) ||
      vehicleForm.luggage_capacity.trim() === '' || !(luggageCapacity > 0)
    ) {
      setVehicleError('Year, seats, and luggage capacity must be positive numbers.')
      return
    }
    setSavingVehicle(true); setVehicleError('')
    try {
      await adminDriverApi.updateVehicle(detail.id, {
        category_id: vehicleForm.category_id || undefined,
        brand_id: vehicleForm.brand_id || undefined,
        model_id: vehicleForm.model_id || null,
        vehicle_name: vehicleForm.vehicle_name,
        number_plate: vehicleForm.number_plate,
        model_year: modelYear,
        color: vehicleForm.color,
        fuel_type: vehicleForm.fuel_type,
        seating_capacity: seatingCapacity,
        luggage_capacity: luggageCapacity,
        ac_availability: vehicleForm.ac_availability,
      }, vehicleForm.reason.trim())
      await fetchDetail()
      setEditingVehicle(false)
    } catch { setVehicleError('Could not save changes. Please try again.') }
    finally { setSavingVehicle(false) }
  }

  function openAction(type: ActionType) { setPendingAction(type) }
  async function executeAction(reason?: string) {
    if (!pendingAction || !detail) return
    setActionLoading(true); setActionError('')
    try {
      if (pendingAction === 'approve')    await adminDriverApi.approve(detail.id)
      if (pendingAction === 'rejectDocs') await adminDriverApi.rejectDocs(detail.id, reason!)
      if (pendingAction === 'ban')        await adminDriverApi.ban(detail.id, reason!)
      if (pendingAction === 'suspend')    await adminDriverApi.suspend(detail.id, reason!)
      if (pendingAction === 'reinstate')  await adminDriverApi.reinstate(detail.id)
      setPendingAction(null)
      await fetchDetail()
    } catch { setActionError('Action failed. Please try again.') }
    finally { setActionLoading(false) }
  }

  async function handleModalDriverAction(type: ActionType, reason?: string) {
    if (!detail) return
    if (type === 'approve')     await adminDriverApi.approve(detail.id)
    if (type === 'rejectDocs')  await adminDriverApi.rejectDocs(detail.id, reason!)
    if (type === 'ban')         await adminDriverApi.ban(detail.id, reason!)
    if (type === 'suspend')     await adminDriverApi.suspend(detail.id, reason!)
    if (type === 'reinstate')   await adminDriverApi.reinstate(detail.id)
    setReviewOpen(false)
    await fetchDetail()
  }

  async function handleDriverDocApprove(docId: string) { await adminDriverApi.approveDriverDoc(docId); await fetchDetail() }
  async function handleDriverDocReject(docId: string, reason: string) { await adminDriverApi.rejectDriverDoc(docId, reason); await fetchDetail() }
  async function handleVehicleDocApprove(docId: string) { await adminDriverApi.approveVehicleDoc(docId); await fetchDetail() }
  async function handleVehicleDocReject(docId: string, reason: string) { await adminDriverApi.rejectVehicleDoc(docId, reason); await fetchDetail() }

  function openReview(initDocIdx = 0) { setReviewInitIdx(initDocIdx); setReviewOpen(true) }

  async function placeHold(reason: string) {
    if (!detail) return
    setPayoutActionLoading(true); setPayoutError('')
    try { await payoutsApi.placeHold(detail.id, reason); setHoldDialogOpen(false) }
    catch { setPayoutError('Could not place hold. Please try again.') }
    finally { setPayoutActionLoading(false) }
  }
  async function releaseHold() {
    if (!detail) return
    setPayoutActionLoading(true); setPayoutError('')
    try { await payoutsApi.releaseHold(detail.id); setReleaseConfirmOpen(false) }
    catch { setPayoutError('Could not release hold. Please try again.') }
    finally { setPayoutActionLoading(false) }
  }
  async function submitAdjustment() {
    if (!detail) return
    const amount = parseFloat(adjustmentAmount)
    if (isNaN(amount) || amount === 0 || adjustmentReason.trim().length < 10) {
      setPayoutError('Enter a non-zero amount and a reason (at least 10 characters).')
      return
    }
    setPayoutActionLoading(true); setPayoutError('')
    try {
      await payoutsApi.createAdjustment(detail.id, amount, adjustmentReason.trim())
      setAdjustmentAmount(''); setAdjustmentReason('')
    } catch { setPayoutError('Could not create adjustment. Please try again.') }
    finally { setPayoutActionLoading(false) }
  }

  if (loading) {
    return <div className="p-6 space-y-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-6 bg-surface-2 rounded animate-pulse" />)}</div>
  }
  if (error || !detail) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-text-muted text-sm">Failed to load driver details.</p>
        <button onClick={() => fetchDetail()} className="text-xs text-primary underline">Retry</button>
      </div>
    )
  }

  const d = detail
  const missingDriver  = REQUIRED_DRIVER_DOCS.filter(k => !d.documents.find(x => x.doc_type === k))
  const missingVehicle = REQUIRED_VEHICLE_DOCS.filter(k => !d.vehicle_documents.find(x => x.doc_type === k))
  const totalMissing   = missingDriver.length + missingVehicle.length
  const unacknowledgedWarnings = d.warnings.filter(w => !w.acknowledged_at).length
  const allDocs = [...d.documents.map(x => ({ ...x, kind: 'driver' as const })), ...d.vehicle_documents.map(x => ({ ...x, kind: 'vehicle' as const }))]
  const selfie = d.documents.find(x => x.doc_type === 'profile_photo')
  function docIdx(docType: string) {
    const idx = allDocs.findIndex(x => x.doc_type === docType)
    return idx >= 0 ? idx : 0
  }

  return (
    <div className="space-y-5">
      <button onClick={() => router.push('/drivers')} className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors">
        <ArrowLeft size={14} /> Back to Drivers
      </button>

      {/* Sticky header */}
      <div className="admin-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <InitialsAvatar name={d.full_name ?? d.phone} size="lg" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-text-primary">{d.full_name ?? '—'}</h1>
                <StatusPill status={d.status} />
                {(d.status === 'pending_docs' || d.status === 'pending_approval') && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-surface-3 text-text-muted capitalize">
                    {d.onboarding_step.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <p className="text-sm text-text-muted font-mono">{d.code}</p>
              <p className="text-sm text-text-secondary">{d.phone}</p>
            </div>
          </div>

          {/* Persistent action bar — lifecycle actions live here, not buried in a tab */}
          <div className="flex gap-2 flex-wrap">
            {d.status === 'pending_approval' && <>
              <button onClick={() => openAction('approve')}    className="px-4 py-2 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">Approve</button>
              <button onClick={() => openAction('rejectDocs')} className="px-4 py-2 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning/6 transition-colors">Reject Docs</button>
              <button onClick={() => openAction('ban')}        className="px-4 py-2 border border-danger text-danger font-semibold rounded-xl text-sm hover:bg-danger/6 transition-colors">Ban</button>
            </>}
            {d.status === 'docs_rejected' && <>
              <button onClick={() => openAction('approve')} className="px-4 py-2 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">Approve</button>
              <button onClick={() => openAction('ban')}      className="px-4 py-2 border border-danger text-danger font-semibold rounded-xl text-sm hover:bg-danger/6 transition-colors">Ban</button>
            </>}
            {d.status === 'active' && (
              <button onClick={() => openAction('suspend')} className="px-4 py-2 border border-warning text-warning font-semibold rounded-xl text-sm hover:bg-warning/6 transition-colors">Suspend</button>
            )}
            {d.status === 'suspended' && (
              <button onClick={() => openAction('reinstate')} className="px-4 py-2 bg-success text-white font-semibold rounded-xl text-sm hover:bg-emerald-600 transition-colors">Reinstate</button>
            )}
          </div>
        </div>

        <div className="mt-4"><AlertStrip d={d} /></div>

        {/* Summary rail */}
        <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: 'Rating', value: d.total_ratings > 0 ? `★ ${parseFloat(d.rating_avg).toFixed(2)}` : '—' },
            { label: 'Documents', value: `${d.documents.length + d.vehicle_documents.length} uploaded` },
            { label: 'Experience', value: d.experience_years != null ? `${d.experience_years} yr${d.experience_years !== 1 ? 's' : ''}` : '—' },
            { label: 'Joined', value: fmt(d.created_at) },
            { label: 'Wallet', value: d.wallet ? `₹${parseFloat(d.wallet.balance).toLocaleString('en-IN')}` : '₹0.00' },
            { label: 'Warnings', value: unacknowledgedWarnings > 0 ? `${unacknowledgedWarnings} open` : `${d.warnings.length} total` },
          ].map(s => (
            <div key={s.label} className="bg-surface-2 rounded-xl p-3 text-center border border-border-light">
              <p className="text-sm font-black text-text-primary">{s.value}</p>
              <p className="text-xs text-text-muted">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="mt-5 flex border-b border-border overflow-x-auto">
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
              {tab.key === 'documents' && (d.documents.length + d.vehicle_documents.length) > 0 && (
                <span className={cn('ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                  d.status === 'pending_approval' ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-text-muted')}>
                  {d.documents.length + d.vehicle_documents.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="pt-5 space-y-4">
          {activeTab === 'overview' && (
            <>
              <div className="bg-surface-2 rounded-xl p-4 border border-border-light space-y-2">
                <p className="text-xs font-semibold text-text-secondary">Contact</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-text-muted">Phone</span>      <span className="text-text-primary font-medium">{d.phone}</span>
                  <span className="text-text-muted">Email</span>      <span className="text-text-primary font-medium">{d.email ?? '—'}</span>
                  <span className="text-text-muted">Gender</span>     <span className="text-text-primary font-medium capitalize">{d.gender ?? '—'}</span>
                  <span className="text-text-muted">DOB</span>        <span className="text-text-primary font-medium">{d.date_of_birth ? fmt(d.date_of_birth) : '—'}</span>
                  <span className="text-text-muted">Address</span>    <span className="text-text-primary font-medium">{d.residential_address ?? '—'}</span>
                  <span className="text-text-muted">City/State</span> <span className="text-text-primary font-medium">{[d.city, d.state].filter(Boolean).join(', ') || '—'}</span>
                  <span className="text-text-muted">Pincode</span>    <span className="text-text-primary font-medium">{d.pincode ?? '—'}</span>
                  <span className="text-text-muted">Emergency</span>  <span className="text-text-primary font-medium">{d.emergency_contact ?? '—'}</span>
                  <span className="text-text-muted">Languages</span>  <span className="text-text-primary font-medium">{d.languages_known.join(', ') || '—'}</span>
                </div>
              </div>
              <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
                <p className="text-xs font-semibold text-text-secondary mb-2">Identity</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-text-muted">Aadhaar</span> <span className="font-mono text-text-primary">{d.aadhaar_number ?? '—'}</span>
                  <span className="text-text-muted">Licence</span> <span className="font-mono text-text-primary">{d.license_number ?? '—'}</span>
                </div>
              </div>
            </>
          )}

          {activeTab === 'documents' && (
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
                  {editingIdentity ? (
                    <div className="space-y-2">
                      <input
                        value={identityForm.full_name}
                        onChange={e => setIdentityForm(f => ({ ...f, full_name: e.target.value }))}
                        placeholder="Full name"
                        className="w-full text-sm font-bold text-text-primary bg-surface border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <div className="flex gap-2 items-center">
                        <span className="text-text-muted w-14 text-xs flex-shrink-0">Aadhaar</span>
                        <input
                          value={identityForm.aadhaar_number}
                          onChange={e => setIdentityForm(f => ({ ...f, aadhaar_number: e.target.value }))}
                          placeholder={d.aadhaar_number ? `On file: ${d.aadhaar_number} — leave blank to keep` : 'Not provided'}
                          className="flex-1 min-w-0 text-xs font-mono text-text-secondary bg-surface border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-[10px] placeholder:text-text-muted"
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="text-text-muted w-14 text-xs flex-shrink-0">Licence</span>
                        <input
                          value={identityForm.license_number}
                          onChange={e => setIdentityForm(f => ({ ...f, license_number: e.target.value }))}
                          className="flex-1 min-w-0 text-xs font-mono text-text-secondary bg-surface border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <textarea
                        value={identityForm.reason}
                        onChange={e => setIdentityForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="Reason for this correction (min 10 characters)…"
                        rows={2}
                        className="w-full text-xs text-text-primary bg-surface border border-border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted"
                      />
                      {identityError && <p className="text-xs text-danger">{identityError}</p>}
                      <div className="flex gap-2 pt-0.5">
                        <button onClick={saveIdentity} disabled={savingIdentity} className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                          {savingIdentity ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingIdentity(false)} disabled={savingIdentity} className="px-3 py-1 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface-2 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-text-primary">{d.full_name ?? d.phone}</p>
                        <button onClick={startEditIdentity} className="text-text-muted hover:text-primary transition-colors flex-shrink-0" aria-label="Edit name and document numbers">
                          <Pencil size={12} />
                        </button>
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs">
                        <div className="flex gap-2">
                          <span className="text-text-muted w-14">Aadhaar</span>
                          {d.aadhaar_number ? <span className="font-mono text-text-secondary">{d.aadhaar_number}</span> : <span className="text-danger font-medium">Not provided</span>}
                        </div>
                        <div className="flex gap-2">
                          <span className="text-text-muted w-14">Licence</span>
                          {d.license_number ? <span className="font-mono text-text-secondary">{d.license_number}</span> : <span className="text-danger font-medium">Not provided</span>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {totalMissing > 0 && (
                <div className="bg-danger/5 border border-danger/20 rounded-xl px-4 py-3 flex items-start gap-2.5">
                  <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-danger mb-0.5">{totalMissing} required document{totalMissing !== 1 ? 's' : ''} missing</p>
                    <p className="text-xs text-danger/75">{[...missingDriver, ...missingVehicle].map(k => docLabel(k)).join(' · ')}</p>
                  </div>
                </div>
              )}

              {d.documents.filter(x => x.doc_type !== 'profile_photo').length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-text-secondary mb-2">Identity Documents</p>
                  <div className="space-y-1.5">
                    {d.documents.filter(x => x.doc_type !== 'profile_photo').map(doc => (
                      <DocCheckItem key={doc.doc_type} docType={doc.doc_type} fileUrl={doc.file_url} status={doc.status} rejectionNote={doc.rejection_note} onClick={() => openReview(docIdx(doc.doc_type))} />
                    ))}
                  </div>
                </div>
              )}

              {(d.vehicle_documents.length > 0 || missingVehicle.length > 0) && (
                <div>
                  <p className="text-xs font-semibold text-text-secondary mb-2">Vehicle Documents</p>
                  <div className="space-y-1.5">
                    {d.vehicle_documents.map(doc => (
                      <DocCheckItem key={doc.doc_type} docType={doc.doc_type} fileUrl={doc.file_url} status={doc.status} rejectionNote={doc.rejection_note} onClick={() => openReview(docIdx(doc.doc_type))} />
                    ))}
                    {missingVehicle.map(key => (
                      <DocCheckItem key={key} docType={key} fileUrl={null} status="missing" onClick={() => {}} />
                    ))}
                  </div>
                </div>
              )}

              {allDocs.length > 0 && (
                <button onClick={() => openReview(0)} className="w-full py-3 bg-primary text-white font-bold text-sm rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                  <Layers size={15} /> Review All Documents
                </button>
              )}
            </div>
          )}

          {activeTab === 'vehicle' && (
            <div>
              {!d.vehicle ? (
                <p className="text-sm text-text-muted text-center py-8">No vehicle registered yet</p>
              ) : (
                <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-text-secondary">Vehicle Details</p>
                    {!editingVehicle && (
                      <button onClick={startEditVehicle} className="text-text-muted hover:text-primary transition-colors" aria-label="Edit vehicle details">
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>

                  {editingVehicle ? (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <select value={vehicleForm.category_id} onChange={e => setVehicleForm(f => ({ ...f, category_id: e.target.value }))}
                          className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="">Category…</option>
                          {vehicleCategories.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                        </select>
                        <select value={vehicleForm.brand_id} onChange={e => setVehicleForm(f => ({ ...f, brand_id: e.target.value }))}
                          className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="">Brand…</option>
                          {vehicleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                      <select value={vehicleForm.model_id} onChange={e => setVehicleForm(f => ({ ...f, model_id: e.target.value }))}
                        className="w-full text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="">Model (optional)…</option>
                        {vehicleModels.map(m => <option key={m.id} value={m.id}>{m.brand_name} · {m.name}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={vehicleForm.vehicle_name} onChange={e => setVehicleForm(f => ({ ...f, vehicle_name: e.target.value }))}
                          placeholder="Vehicle name" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <input value={vehicleForm.number_plate} onChange={e => setVehicleForm(f => ({ ...f, number_plate: e.target.value }))}
                          placeholder="Plate number" className="text-sm font-mono bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" value={vehicleForm.model_year} onChange={e => setVehicleForm(f => ({ ...f, model_year: e.target.value }))}
                          placeholder="Year" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <input value={vehicleForm.color} onChange={e => setVehicleForm(f => ({ ...f, color: e.target.value }))}
                          placeholder="Color" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <select value={vehicleForm.fuel_type} onChange={e => setVehicleForm(f => ({ ...f, fuel_type: e.target.value }))}
                          className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="petrol">Petrol</option>
                          <option value="diesel">Diesel</option>
                          <option value="cng">CNG</option>
                          <option value="electric">EV</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-center">
                        <input type="number" value={vehicleForm.seating_capacity} onChange={e => setVehicleForm(f => ({ ...f, seating_capacity: e.target.value }))}
                          placeholder="Seats" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <input type="number" value={vehicleForm.luggage_capacity} onChange={e => setVehicleForm(f => ({ ...f, luggage_capacity: e.target.value }))}
                          placeholder="Luggage" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                          <input type="checkbox" checked={vehicleForm.ac_availability} onChange={e => setVehicleForm(f => ({ ...f, ac_availability: e.target.checked }))} />
                          AC
                        </label>
                      </div>
                      <textarea
                        value={vehicleForm.reason}
                        onChange={e => setVehicleForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="Reason for this correction (min 10 characters)…"
                        rows={2}
                        className="w-full text-xs text-text-primary bg-surface border border-border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted"
                      />
                      {vehicleError && <p className="text-xs text-danger">{vehicleError}</p>}
                      <div className="flex gap-2 pt-0.5">
                        <button onClick={saveVehicle} disabled={savingVehicle} className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                          {savingVehicle ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingVehicle(false)} disabled={savingVehicle} className="px-3 py-1 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface-2 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <span className="text-text-muted">Name</span>     <span className="font-medium text-text-primary">{d.vehicle.vehicle_name}</span>
                      <span className="text-text-muted">Brand</span>    <span className="font-medium text-text-primary">{d.vehicle.brand}</span>
                      <span className="text-text-muted">Plate</span>    <span className="font-mono font-bold text-text-primary">{d.vehicle.number_plate}</span>
                      <span className="text-text-muted">Category</span> <span className="font-medium text-text-primary">{d.vehicle.category}</span>
                      <span className="text-text-muted">Year</span>     <span className="font-medium text-text-primary">{d.vehicle.model_year}</span>
                      <span className="text-text-muted">Color</span>    <span className="font-medium text-text-primary capitalize">{d.vehicle.color}</span>
                      <span className="text-text-muted">Fuel</span>     <span className="font-medium text-text-primary capitalize">{d.vehicle.fuel_type}</span>
                      <span className="text-text-muted">Seats</span>    <span className="font-medium text-text-primary">{d.vehicle.seating_capacity}</span>
                      <span className="text-text-muted">Luggage</span>  <span className="font-medium text-text-primary">{d.vehicle.luggage_capacity}</span>
                      <span className="text-text-muted">AC</span>       <span className="font-medium text-text-primary">{d.vehicle.ac_availability ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-2">Warnings</p>
                {d.warnings.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-6">No warnings issued</p>
                ) : d.warnings.map(w => (
                  <div key={w.id} className="bg-surface-2 rounded-xl px-4 py-3 border border-border-light mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-danger/10 text-danger capitalize">{w.severity}</span>
                      <span className="text-xs font-semibold text-text-primary capitalize">{w.category.replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-xs text-text-secondary">{w.description}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {fmt(w.created_at)}{w.issued_by_email ? ` · ${w.issued_by_email}` : ''}{!w.acknowledged_at ? ' · Unacknowledged' : ''}
                    </p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-2">Recent Ratings</p>
                {d.ratings.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-6">No ratings yet</p>
                ) : d.ratings.map(rt => (
                  <div key={rt.id} className="bg-surface-2 rounded-xl px-4 py-3 border border-border-light mb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-text-primary">★ {rt.score}</span>
                      <span className="text-xs text-text-muted">{fmt(rt.created_at)}</span>
                    </div>
                    {rt.comment && <p className="text-xs text-text-secondary mt-1">{rt.comment}</p>}
                    {rt.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {rt.tags.map(t => <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface-3 text-text-muted">{t}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'rides' && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2">Ride History</p>
              {ridesLoading ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-surface-2 rounded-xl animate-pulse" />)}</div>
              ) : rides.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-8">No rides yet</p>
              ) : (
                <>
                  {rides.map(rd => (
                    <div key={rd.id} className="bg-surface-2 rounded-xl px-4 py-3 border border-border-light mb-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-text-primary capitalize">{rd.ride_type.replace(/_/g, ' ')} · {rd.user_name}</p>
                        <p className="text-xs text-text-muted mt-0.5">{fmt(rd.requested_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-medium text-text-primary capitalize">{rd.status.replace(/_/g, ' ')}</p>
                        {rd.fare && <p className="text-xs text-text-muted mt-0.5">₹{parseFloat(rd.fare).toLocaleString('en-IN')}</p>}
                      </div>
                    </div>
                  ))}
                  {ridesPagination && ridesPagination.pages > 1 && (
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-light">
                      <p className="text-xs text-text-muted">Page {ridesPagination.page} of {ridesPagination.pages}</p>
                      <div className="flex gap-2">
                        <button disabled={ridesPage <= 1} onClick={() => setRidesPage(p => p - 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 transition-colors">Previous</button>
                        <button disabled={ridesPage >= ridesPagination.pages} onClick={() => setRidesPage(p => p + 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 transition-colors">Next</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'earnings' && (
            <div className="space-y-5">
              <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary">Wallet</p>
                  {d.wallet?.is_frozen && <span className="text-[10px] font-bold text-danger bg-danger/10 rounded-full px-2 py-0.5">Frozen</span>}
                </div>
                <p className={cn('text-lg font-bold', d.wallet && parseFloat(d.wallet.balance) < 500 ? 'text-warning' : 'text-text-primary')}>
                  ₹{d.wallet ? parseFloat(d.wallet.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                </p>
              </div>

              <div className="bg-surface-2 rounded-xl p-4 border border-border-light space-y-3">
                <p className="text-xs font-semibold text-text-secondary">Payout Controls</p>
                {payoutError && <p className="text-xs text-danger">{payoutError}</p>}
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setHoldDialogOpen(true)} className="px-3 py-1.5 text-xs font-semibold border border-warning text-warning rounded-lg hover:bg-warning/6 transition-colors">Place Payout Hold</button>
                  <button onClick={() => setReleaseConfirmOpen(true)} className="px-3 py-1.5 text-xs font-semibold border border-border text-text-secondary rounded-lg hover:bg-surface-3 transition-colors">Release Hold</button>
                </div>
                <div className="pt-2 border-t border-border-light space-y-2">
                  <p className="text-xs font-semibold text-text-secondary">Manual Adjustment</p>
                  <div className="flex gap-2">
                    <input
                      value={adjustmentAmount}
                      onChange={e => setAdjustmentAmount(e.target.value)}
                      placeholder="Amount (₹, negative to deduct)"
                      className="flex-1 text-xs bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <textarea
                    value={adjustmentReason}
                    onChange={e => setAdjustmentReason(e.target.value)}
                    placeholder="Reason (min 10 characters)…"
                    rows={2}
                    className="w-full text-xs bg-surface border border-border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button onClick={submitAdjustment} disabled={payoutActionLoading} className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {payoutActionLoading ? 'Submitting…' : 'Add Adjustment'}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary mb-2">Transactions</p>
                {paymentsLoading ? (
                  <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-surface-2 rounded-xl animate-pulse" />)}</div>
                ) : payments.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8">No transactions yet</p>
                ) : (
                  <>
                    {payments.map(p => (
                      <div key={p.id} className="bg-surface-2 rounded-xl px-4 py-3 border border-border-light mb-2 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-text-primary capitalize">{p.channel.replace(/_/g, ' ')} · {p.user_name}</p>
                          <p className="text-xs text-text-muted mt-0.5">{fmt(p.created_at)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-medium text-text-primary capitalize">{p.status}</p>
                          <p className="text-xs text-text-muted mt-0.5">₹{parseFloat(p.amount).toLocaleString('en-IN')} · earned ₹{parseFloat(p.driver_earning).toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                    ))}
                    {paymentsPagination && paymentsPagination.pages > 1 && (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-light">
                        <p className="text-xs text-text-muted">Page {paymentsPagination.page} of {paymentsPagination.pages}</p>
                        <div className="flex gap-2">
                          <button disabled={paymentsPage <= 1} onClick={() => setPaymentsPage(p => p - 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 transition-colors">Previous</button>
                          <button disabled={paymentsPage >= paymentsPagination.pages} onClick={() => setPaymentsPage(p => p + 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 transition-colors">Next</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-text-secondary mb-3">Status History</p>
                {d.status_history.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8">No status changes recorded</p>
                ) : d.status_history.map((h, i) => (
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

              <div>
                <p className="text-xs font-semibold text-text-secondary mb-3">Admin Audit Trail</p>
                {auditLoading ? (
                  <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-surface-2 rounded-xl animate-pulse" />)}</div>
                ) : auditEntries.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8">No admin edits recorded</p>
                ) : (
                  <>
                    {auditEntries.map(a => {
                      const diffs = diffFields(a.before_state, a.after_state)
                      return (
                        <div key={a.id} className="bg-surface-2 rounded-xl px-4 py-3 border border-border-light mb-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-text-primary">{a.action.replace(/_/g, ' ')}</span>
                            <span className="text-xs text-text-muted">{fmt(a.created_at)}</span>
                          </div>
                          <p className="text-xs text-text-muted mt-0.5">{a.admin_email ?? 'system'}</p>
                          {a.reason && <p className="text-xs text-text-secondary mt-1">&quot;{a.reason}&quot;</p>}
                          {diffs.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {diffs.map(diff => (
                                <p key={diff.field} className="text-[10px] font-mono text-text-muted">
                                  {diff.field}: {String(diff.from ?? '—')} → {String(diff.to ?? '—')}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {auditPagination && auditPagination.pages > 1 && (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-light">
                        <p className="text-xs text-text-muted">Page {auditPagination.page} of {auditPagination.pages}</p>
                        <div className="flex gap-2">
                          <button disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 transition-colors">Previous</button>
                          <button disabled={auditPage >= auditPagination.pages} onClick={() => setAuditPage(p => p + 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 transition-colors">Next</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Approve / Reinstate confirm */}
      <ConfirmDialog
        open={pendingAction === 'approve' || pendingAction === 'reinstate'}
        onOpenChange={v => { if (!v) { setPendingAction(null); setActionError('') } }}
        title={pendingAction === 'approve' ? 'Approve Driver' : 'Reinstate Driver'}
        description={actionError || (pendingAction === 'approve' ? `Approve ${d.full_name ?? d.phone} as an active driver?` : `Reinstate ${d.full_name ?? d.phone}?`)}
        confirmLabel={actionLoading ? 'Submitting…' : pendingAction === 'approve' ? 'Approve' : 'Reinstate'}
        variant={actionError ? 'danger' : 'success'}
        onConfirm={() => { if (!actionLoading) executeAction() }}
      />
      <ReasonDialog
        open={pendingAction === 'rejectDocs'}
        title="Reject Documents"
        description={`Tell ${d.full_name ?? d.phone} what needs to be fixed. They will be asked to re-upload and resubmit.`}
        confirmLabel="Reject Docs"
        variant="warning"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />
      <ReasonDialog
        open={pendingAction === 'ban'}
        title="Ban Driver"
        description={`Permanently ban ${d.full_name ?? d.phone}? This cannot be undone.`}
        confirmLabel="Ban Driver"
        variant="danger"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />
      <ReasonDialog
        open={pendingAction === 'suspend'}
        title="Suspend Driver"
        description={`Suspend ${d.full_name ?? d.phone}? They will not be able to accept rides.`}
        confirmLabel="Suspend Driver"
        variant="warning"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />

      <ReasonDialog
        open={holdDialogOpen}
        title="Place Payout Hold"
        description={`Hold all payouts for ${d.full_name ?? d.phone} until released.`}
        confirmLabel="Place Hold"
        variant="warning"
        loading={payoutActionLoading}
        onCancel={() => setHoldDialogOpen(false)}
        onConfirm={reason => placeHold(reason)}
      />
      <ConfirmDialog
        open={releaseConfirmOpen}
        onOpenChange={v => { if (!v) setReleaseConfirmOpen(false) }}
        title="Release Payout Hold"
        description={`Release the payout hold for ${d.full_name ?? d.phone}?`}
        confirmLabel={payoutActionLoading ? 'Releasing…' : 'Release Hold'}
        variant="success"
        onConfirm={() => { if (!payoutActionLoading) releaseHold() }}
      />

      {reviewOpen && (
        <DocReviewModal
          detail={d}
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
