import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Upload, CheckCircle2, AlertCircle,
  Eye, RefreshCw, Shield, Car, X,
} from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import DatePickerSheet from '@/components/ui/DatePickerSheet'
import { onboardingApi, type DocumentStatus } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

const TODAY_ISO = new Date().toISOString().slice(0, 10)

// ── Types ──────────────────────────────────────────────────────────────────────

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface SlotState {
  state: UploadState
  url: string | null
  error: string | null
  docStatus: string | null
  rejectionNote: string | null
}

interface SlotDef {
  key: string
  slotLabel: string   // 'Front' | 'Back' | '' for single-slot groups
  accept: string
  isVehicle: boolean
}

interface DocGroupDef {
  groupKey: string
  label: string
  required: boolean
  slots: SlotDef[]
  hasExpiry: boolean
  expiryRequired: boolean
}

// ── Document group definitions ─────────────────────────────────────────────────

const DRIVER_GROUPS: DocGroupDef[] = [
  {
    groupKey: 'driving_license',
    label: 'Driving Licence',
    required: true,
    slots: [
      { key: 'driving_license_front', slotLabel: 'Front', accept: 'image/*,application/pdf', isVehicle: false },
      { key: 'driving_license_back',  slotLabel: 'Back',  accept: 'image/*,application/pdf', isVehicle: false },
    ],
    hasExpiry: true,
    expiryRequired: true,
  },
  {
    groupKey: 'aadhaar',
    label: 'Aadhaar Card',
    required: true,
    slots: [
      { key: 'aadhaar_front', slotLabel: 'Front', accept: 'image/*', isVehicle: false },
      { key: 'aadhaar_back',  slotLabel: 'Back',  accept: 'image/*', isVehicle: false },
    ],
    hasExpiry: false,
    expiryRequired: false,
  },
]

const VEHICLE_GROUPS: DocGroupDef[] = [
  {
    groupKey: 'vehicle_rc',
    label: 'Registration Certificate (RC)',
    required: true,
    slots: [{ key: 'vehicle_rc', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: false,
    expiryRequired: false,
  },
  {
    groupKey: 'insurance',
    label: 'Insurance',
    required: true,
    slots: [{ key: 'insurance', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: true,
  },
  {
    groupKey: 'permit',
    label: 'Commercial Permit',
    required: true,
    slots: [{ key: 'permit', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: true,
  },
  {
    groupKey: 'pollution_cert',
    label: 'PUC Certificate',
    required: false,
    slots: [{ key: 'pollution_cert', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: false,
  },
  {
    groupKey: 'fitness_cert',
    label: 'Fitness Certificate',
    required: false,
    slots: [{ key: 'fitness_cert', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: false,
  },
]

const ALL_GROUPS = [...DRIVER_GROUPS, ...VEHICLE_GROUPS]
const ALL_KEYS   = ALL_GROUPS.flatMap(g => g.slots.map(s => s.key))

function initSlotState(): Record<string, SlotState> {
  return Object.fromEntries(
    ALL_KEYS.map(k => [k, { state: 'idle', url: null, error: null, docStatus: null, rejectionNote: null }])
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const STEPS = ['personal_info', 'vehicle_info', 'documents', 'selfie']

export default function Documents() {
  const navigate   = useNavigate()
  const driver     = useAuthStore(s => s.driver)

  const [licenseNumber, setLicenseNumber] = useState('')
  const [aadhaarNumber, setAadhaarNumber] = useState('')
  const [identitySaved, setIdentitySaved] = useState(false)
  const [identityError, setIdentityError] = useState('')

  const [slotState, setSlotState] = useState<Record<string, SlotState>>(initSlotState)
  // keyed by groupKey — one expiry per legal document, not per photo
  const [validUntil, setValidUntil] = useState<Record<string, string>>({})
  const [isFetching, setIsFetching] = useState(true)
  const [isSaving,   setIsSaving]   = useState(false)
  const [preview,    setPreview]    = useState<{ url: string; label: string } | null>(null)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const stepIdx  = STEPS.indexOf(driver?.onboarding_step ?? 'documents')

  useEffect(() => {
    const load = async () => {
      try {
        const status: DocumentStatus = await onboardingApi.getDocumentStatus()
        if (status.identity.license_number) setLicenseNumber(status.identity.license_number)
        if (status.identity.aadhaar_number)  setAadhaarNumber(status.identity.aadhaar_number)
        if (status.identity.license_number && status.identity.aadhaar_number) setIdentitySaved(true)

        const merged: Record<string, SlotState> = initSlotState()
        for (const [k, v] of Object.entries({ ...status.photos, ...status.vehicle_docs })) {
          if (k in merged) {
            merged[k] = { state: v.uploaded ? 'done' : 'idle', url: v.url, error: null, docStatus: v.status, rejectionNote: v.rejection_note }
          }
        }
        setSlotState(merged)
      } catch {
        // first visit — start fresh
      } finally {
        setIsFetching(false)
      }
    }
    void load()
  }, [])

  const setSlot = (key: string, patch: Partial<SlotState>) =>
    setSlotState(prev => ({ ...prev, [key]: { ...prev[key]!, ...patch } }))

  const handleFileSelect = async (slot: SlotDef, groupKey: string, file: File) => {
    setSlot(slot.key, { state: 'uploading', error: null, docStatus: null, rejectionNote: null })
    try {
      const expiry = validUntil[groupKey]
      const result = slot.isVehicle
        ? await onboardingApi.uploadVehicleDoc(file, slot.key, undefined, expiry)
        : await onboardingApi.uploadDriverDoc(file, slot.key, expiry)
      setSlot(slot.key, { state: 'done', url: result.file_url, error: null, docStatus: 'pending', rejectionNote: null })
    } catch {
      setSlot(slot.key, { state: 'error', error: 'Upload failed. Tap to retry.' })
    }
  }

  const handleIdentityBlur = async () => {
    if (!licenseNumber.trim() || aadhaarNumber.length !== 12) return
    setIdentityError('')
    try {
      await onboardingApi.saveIdentityNumbers({
        license_number: licenseNumber.trim().toUpperCase(),
        aadhaar_number: aadhaarNumber,
      })
      setIdentitySaved(true)
    } catch {
      setIdentityError("Couldn't save. Check your details.")
    }
  }

  const requiredKeys          = ALL_GROUPS.filter(g => g.required).flatMap(g => g.slots.map(s => s.key))
  const allDocsUploaded       = requiredKeys.every(k => slotState[k]?.state === 'done')
  const requiredExpiryGroups  = ALL_GROUPS.filter(g => g.required && g.hasExpiry && g.expiryRequired)
  const allExpiriesFilled     = requiredExpiryGroups.every(g => !!validUntil[g.groupKey])
  const identityFilled        = licenseNumber.trim().length > 0 && aadhaarNumber.length === 12
  const canContinue           = allDocsUploaded && allExpiriesFilled && (identitySaved || identityFilled)

  const handleContinue = async () => {
    if (!identitySaved && identityFilled) {
      setIsSaving(true)
      setIdentityError('')
      try {
        await onboardingApi.saveIdentityNumbers({
          license_number: licenseNumber.trim().toUpperCase(),
          aadhaar_number: aadhaarNumber,
        })
        setIdentitySaved(true)
      } catch {
        setIdentityError("Couldn't save. Check your details.")
        setIsSaving(false)
        return
      }
      setIsSaving(false)
    }
    navigate('/onboarding/selfie')
  }

  const driverSectionDone  = DRIVER_GROUPS.filter(g => g.required).every(g => g.slots.every(s => slotState[s.key]?.state === 'done'))
  const vehicleSectionDone = VEHICLE_GROUPS.filter(g => g.required).every(g => g.slots.every(s => slotState[s.key]?.state === 'done'))

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <OcarSpinner size={32} variant="color" />
      </div>
    )
  }

  const missingHint = !identityFilled
    ? 'Enter your licence and Aadhaar numbers'
    : !allDocsUploaded
      ? 'Upload all required documents to continue'
      : !allExpiriesFilled
        ? `Set expiry date for: ${requiredExpiryGroups.filter(g => !validUntil[g.groupKey]).map(g => g.label).join(', ')}`
        : ''

  return (
    <div className="bg-bg text-text-primary min-h-screen">

      {/* ── Sticky header: step bar + back/title ── */}
      <div
        className="sticky top-0 z-10 bg-bg px-5 pt-14 pb-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex gap-1.5 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <p className="text-text-muted text-xs">Step 3 of 4</p>
            <h1 className="text-xl font-bold">Documents</h1>
          </div>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="px-5 pt-4 pb-40">
        <p className="text-text-muted text-xs mb-5">Progress is saved automatically</p>

        <div className="space-y-3">

          {/* Identity Numbers */}
          <div className="rounded-2xl border border-border bg-surface-2 p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield size={15} className="text-primary" />
                <h2 className="text-sm font-bold">Identity Numbers</h2>
              </div>
              {identitySaved && <CheckCircle2 size={15} className="text-green-500" />}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                  Driving Licence Number <span className="text-accent-red">*</span>
                </label>
                <input
                  className="input-dark w-full font-mono uppercase"
                  placeholder="OD0519910012345"
                  value={licenseNumber}
                  onChange={e => { setLicenseNumber(e.target.value.toUpperCase()); setIdentitySaved(false) }}
                  onBlur={() => void handleIdentityBlur()}
                />
              </div>
              <div>
                <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                  Aadhaar Number <span className="text-accent-red">*</span>
                </label>
                <p className="text-text-muted text-xs mb-1.5">12-digit number on your Aadhaar card</p>
                <input
                  className="input-dark w-full font-mono tracking-widest"
                  placeholder="XXXXXXXXXXXX"
                  inputMode="numeric"
                  maxLength={12}
                  value={aadhaarNumber}
                  onChange={e => { setAadhaarNumber(e.target.value.replace(/\D/g, '').slice(0, 12)); setIdentitySaved(false) }}
                  onBlur={() => void handleIdentityBlur()}
                />
              </div>
              {identityError && (
                <div className="flex items-center gap-2 bg-accent-red/10 border border-accent-red/20 rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="text-accent-red flex-shrink-0" />
                  <p className="text-accent-red text-xs font-medium">{identityError}</p>
                </div>
              )}
            </div>
          </div>

          {/* Driver Documents */}
          <SectionHeader icon="driver" label="Driver Documents" done={driverSectionDone} />
          {DRIVER_GROUPS.map(group => (
            <DocGroupCard
              key={group.groupKey}
              group={group}
              slotState={slotState}
              validUntil={validUntil[group.groupKey] ?? ''}
              fileRefs={fileRefs}
              onFileSelect={(slot, file) => void handleFileSelect(slot, group.groupKey, file)}
              onValidUntilChange={v => setValidUntil(prev => ({ ...prev, [group.groupKey]: v }))}
              onPreview={(url, label) => setPreview({ url, label })}
            />
          ))}

          {/* Vehicle Documents */}
          <SectionHeader icon="vehicle" label="Vehicle Documents" done={vehicleSectionDone} />
          {VEHICLE_GROUPS.map(group => (
            <DocGroupCard
              key={group.groupKey}
              group={group}
              slotState={slotState}
              validUntil={validUntil[group.groupKey] ?? ''}
              fileRefs={fileRefs}
              onFileSelect={(slot, file) => void handleFileSelect(slot, group.groupKey, file)}
              onValidUntilChange={v => setValidUntil(prev => ({ ...prev, [group.groupKey]: v }))}
              onPreview={(url, label) => setPreview({ url, label })}
            />
          ))}

        </div>
      </div>

      {/* ── Sticky footer CTA ── */}
      <div className="fixed bottom-0 left-0 right-0 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-sm border-t border-border z-20">
        {!canContinue && missingHint && (
          <p className="text-text-muted text-xs text-center mb-2">{missingHint}</p>
        )}
        <button
          onClick={() => void handleContinue()}
          disabled={!canContinue || isSaving}
          className="btn-go w-full"
          style={{ minHeight: 52 }}
        >
          {isSaving
            ? <span className="flex items-center justify-center gap-2"><OcarSpinner size={16} variant="white" />Saving…</span>
            : 'Continue to Selfie'}
        </button>
      </div>

      {/* In-app preview */}
      {preview && <DocPreviewModal url={preview.url} label={preview.label} onClose={() => setPreview(null)} />}
    </div>
  )
}

// ── SectionHeader ──────────────────────────────────────────────────────────────

function SectionHeader({ icon, label, done }: { icon: 'driver' | 'vehicle'; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500/15' : 'bg-primary/10'}`}>
        {icon === 'driver'
          ? <Shield size={13} className={done ? 'text-green-500' : 'text-primary'} />
          : <Car    size={13} className={done ? 'text-green-500' : 'text-primary'} />}
      </div>
      <p className="text-sm font-bold text-text-primary">{label}</p>
      {done && <CheckCircle2 size={14} className="text-green-500 ml-auto" />}
    </div>
  )
}

// ── DocGroupCard ───────────────────────────────────────────────────────────────

interface DocGroupCardProps {
  group: DocGroupDef
  slotState: Record<string, SlotState>
  validUntil: string
  fileRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>
  onFileSelect: (slot: SlotDef, file: File) => void
  onValidUntilChange: (v: string) => void
  onPreview: (url: string, label: string) => void
}

function DocGroupCard({ group, slotState, validUntil, fileRefs, onFileSelect, onValidUntilChange, onPreview }: DocGroupCardProps) {
  const allUploaded = group.slots.every(s => slotState[s.key]?.state === 'done')
  const anyRejected = group.slots.some(s => slotState[s.key]?.docStatus === 'rejected')
  const isComplete  = allUploaded && (!group.hasExpiry || !group.expiryRequired || !!validUntil)

  const borderClass = anyRejected ? 'border-amber-500/40' : isComplete ? 'border-green-500/30' : 'border-border'

  return (
    <div className={`rounded-2xl border-2 bg-surface-2 transition-colors ${borderClass}`}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          {anyRejected      && <AlertCircle  size={15} className="text-amber-500 flex-shrink-0" />}
          {isComplete && !anyRejected && <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />}
          <h3 className="text-sm font-bold text-text-primary truncate">{group.label}</h3>
        </div>
        <span className={`flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full ml-3 ${
          group.required ? 'text-primary bg-primary/10' : 'text-text-muted bg-surface-3'
        }`}>
          {group.required ? 'Required' : 'Optional'}
        </span>
      </div>

      {/* Slots — 2-col for paired docs, full-width for single */}
      <div className={`px-3 pb-3 ${group.slots.length === 2 ? 'grid grid-cols-2 gap-2.5' : ''}`}>
        {group.slots.map(slot => (
          <DocSlot
            key={slot.key}
            slot={slot}
            state={slotState[slot.key]!}
            inputRef={el => { fileRefs.current[slot.key] = el }}
            onTrigger={() => fileRefs.current[slot.key]?.click()}
            onFileChange={file => onFileSelect(slot, file)}
            onPreview={() => {
              const u = slotState[slot.key]?.url
              if (u) onPreview(u, slot.slotLabel ? `${group.label} (${slot.slotLabel})` : group.label)
            }}
          />
        ))}
      </div>

      {/* Shared expiry date — belongs to the whole document, not one photo */}
      {group.hasExpiry && (
        <div className="mx-3 mb-3 pt-3 border-t border-border/40">
          <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 block">
            Expiry Date{group.expiryRequired && <span className="text-accent-red ml-0.5"> *</span>}
          </label>
          <DatePickerSheet
            label={`${group.label} Expiry`}
            value={validUntil}
            onChange={onValidUntilChange}
            minDate={TODAY_ISO}
            placeholder="Select expiry date"
          />
        </div>
      )}
    </div>
  )
}

// ── DocSlot ────────────────────────────────────────────────────────────────────

interface DocSlotProps {
  slot: SlotDef
  state: SlotState
  inputRef: (el: HTMLInputElement | null) => void
  onTrigger: () => void
  onFileChange: (file: File) => void
  onPreview: () => void
}

function DocSlot({ slot, state, inputRef, onTrigger, onFileChange, onPreview }: DocSlotProps) {
  const { state: uploadState, url, error, docStatus, rejectionNote } = state
  const isDone      = uploadState === 'done'
  const isUploading = uploadState === 'uploading'
  const isError     = uploadState === 'error'
  const isRejected  = isDone && docStatus === 'rejected'

  return (
    <div>
      <input
        type="file"
        accept={slot.accept}
        className="hidden"
        ref={inputRef}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onFileChange(f); e.target.value = '' } }}
      />

      {slot.slotLabel && (
        <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-1.5 text-center">
          {slot.slotLabel}
        </p>
      )}

      {isDone ? (
        /* ── Uploaded state: natural-flow layout, no absolute overlap ── */
        <div className={`rounded-xl border aspect-[4/3] flex flex-col items-center justify-center gap-1 ${
          isRejected ? 'border-amber-500/30 bg-amber-500/5' : 'border-green-500/30 bg-green-500/5'
        }`}>
          {isRejected
            ? <AlertCircle  size={20} className="text-amber-500" />
            : <CheckCircle2 size={20} className="text-green-500" />}
          <p className={`text-[10px] font-bold ${isRejected ? 'text-amber-500' : 'text-green-600'}`}>
            {isRejected ? 'Rejected' : 'Uploaded'}
          </p>
          {isRejected && rejectionNote && (
            <p className="text-[9px] text-amber-600 text-center px-2 leading-snug">{rejectionNote}</p>
          )}
          {/* Action row — in natural flow, no absolute crowding */}
          <div className="flex gap-1 mt-1">
            {url && (
              <button type="button" onClick={onPreview}
                className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-black/10 text-[10px] font-medium text-text-secondary active:opacity-70">
                <Eye size={10} /> View
              </button>
            )}
            <button type="button" onClick={onTrigger}
              className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-black/10 text-[10px] font-medium text-text-secondary active:opacity-70">
              <RefreshCw size={10} /> Replace
            </button>
          </div>
        </div>

      ) : (
        /* ── Upload / retry state ── */
        <button
          type="button"
          onClick={!isUploading ? onTrigger : undefined}
          className={`w-full rounded-xl border-2 border-dashed aspect-[4/3] flex flex-col items-center justify-center gap-1.5 transition-all ${
            isUploading ? 'border-primary/40 bg-primary/5 cursor-default'
            : isError   ? 'border-accent-red/40 bg-accent-red/5'
            :             'border-border hover:border-primary/40 active:bg-primary/5'
          }`}
        >
          {isUploading
            ? <OcarSpinner size={18} variant="color" />
            : isError
              ? <AlertCircle size={18} className="text-accent-red" />
              : <Upload size={18} className="text-text-muted" />}
          <p className="text-[10px] text-text-muted text-center px-2 leading-snug">
            {isUploading ? 'Uploading…'
            : isError    ? (error ?? 'Tap to retry')
            :              'Tap to upload'}
          </p>
        </button>
      )}
    </div>
  )
}

// ── DocPreviewModal ────────────────────────────────────────────────────────────

function DocPreviewModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const isPdf = /\.pdf($|\?)/i.test(url) || url.includes('application%2Fpdf')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // overflow-hidden prevents body scroll leaking into the modal
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden" style={{ background: '#0d0d0d' }}>

      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          paddingTop: 'max(1rem, env(safe-area-inset-top))',
          paddingBottom: '0.875rem',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 active:opacity-70 transition-opacity"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        >
          <X size={20} className="text-white" strokeWidth={2.5} />
        </button>
        <p className="flex-1 text-white text-[15px] font-semibold truncate">{label}</p>
      </div>

      {/* Document — min-h-0 allows flex-1 to shrink below natural content height */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4">
        {isPdf
          ? <iframe src={url} title={label} className="w-full h-full rounded-2xl bg-white" style={{ border: 'none' }} />
          : <img src={url} alt={label} className="max-w-full max-h-full object-contain rounded-2xl select-none" draggable={false} style={{ touchAction: 'pan-x pan-y pinch-zoom' }} />}
      </div>

      {/* Hint */}
      <div
        className="flex-shrink-0 flex justify-center"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))', paddingTop: '0.5rem' }}
      >
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>Pinch to zoom</p>
      </div>
    </div>
  )
}
