import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2,
  Eye, RefreshCw, Shield, FileText, Car, X,
} from 'lucide-react'
import { onboardingApi, type DocumentStatus } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface DocRowState {
  state: UploadState
  url: string | null
  error: string | null
  docStatus: string | null
  rejectionNote: string | null
}

const DRIVER_DOCS = [
  { key: 'driving_license', label: 'Driving Licence', required: true, accept: 'image/*,application/pdf', needsExpiry: true  },
  { key: 'aadhaar_front',   label: 'Aadhaar Front',   required: true, accept: 'image/*',                  needsExpiry: false },
  { key: 'aadhaar_back',    label: 'Aadhaar Back',    required: true, accept: 'image/*',                  needsExpiry: false },
] as const

const VEHICLE_DOCS = [
  { key: 'vehicle_rc', label: 'Vehicle RC', required: true, accept: 'image/*,application/pdf', needsExpiry: true },
  { key: 'insurance',  label: 'Insurance',  required: true, accept: 'image/*,application/pdf', needsExpiry: true },
  { key: 'permit',     label: 'Permit',     required: true, accept: 'image/*,application/pdf', needsExpiry: true },
] as const

function initDocState(): Record<string, DocRowState> {
  const keys = [...DRIVER_DOCS.map(d => d.key), ...VEHICLE_DOCS.map(d => d.key)]
  return Object.fromEntries(keys.map(k => [k, { state: 'idle', url: null, error: null, docStatus: null, rejectionNote: null }]))
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2 block">{label}</label>
      {children}
      {hint && <p className="text-text-muted text-xs mt-1">{hint}</p>}
    </div>
  )
}

const STEPS = ['personal_info', 'vehicle_info', 'documents', 'selfie']

export default function Documents() {
  const navigate   = useNavigate()
  const driver     = useAuthStore(s => s.driver)

  const [licenseNumber, setLicenseNumber] = useState('')
  const [aadhaarNumber, setAadhaarNumber] = useState('')
  const [identitySaved, setIdentitySaved] = useState(false)
  const [identityError, setIdentityError] = useState('')

  const [docState,  setDocState]  = useState<Record<string, DocRowState>>(initDocState)
  const [validUntil, setValidUntil] = useState<Record<string, string>>({})
  const [isFetching, setIsFetching] = useState(true)
  const [isSaving,   setIsSaving]   = useState(false)
  const [preview,    setPreview]    = useState<{ url: string; label: string } | null>(null)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const stepIdx = STEPS.indexOf(driver?.onboarding_step ?? 'documents')

  useEffect(() => {
    const load = async () => {
      try {
        const status: DocumentStatus = await onboardingApi.getDocumentStatus()
        if (status.identity.license_number) setLicenseNumber(status.identity.license_number)
        if (status.identity.aadhaar_number)  setAadhaarNumber(status.identity.aadhaar_number)
        if (status.identity.license_number && status.identity.aadhaar_number) setIdentitySaved(true)
        const merged: Record<string, DocRowState> = initDocState()
        for (const [k, v] of Object.entries(status.photos)) {
          if (k in merged) merged[k] = { state: v.uploaded ? 'done' : 'idle', url: v.url, error: null, docStatus: v.status, rejectionNote: v.rejection_note }
        }
        for (const [k, v] of Object.entries(status.vehicle_docs)) {
          if (k in merged) merged[k] = { state: v.uploaded ? 'done' : 'idle', url: v.url, error: null, docStatus: v.status, rejectionNote: v.rejection_note }
        }
        setDocState(merged)
      } catch {}
      finally { setIsFetching(false) }
    }
    void load()
  }, [])

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

  const setRow = (key: string, patch: Partial<DocRowState>) =>
    setDocState(prev => ({ ...prev, [key]: { ...prev[key]!, ...patch } }))

  const handleFileSelect = async (key: string, isVehicleDoc: boolean, file: File) => {
    setRow(key, { state: 'uploading', error: null, docStatus: null, rejectionNote: null })
    try {
      const expiry = validUntil[key]
      const result = isVehicleDoc
        ? await onboardingApi.uploadVehicleDoc(file, key, undefined, expiry)
        : await onboardingApi.uploadDriverDoc(file, key, expiry)
      setRow(key, { state: 'done', url: result.file_url, error: null, docStatus: 'pending', rejectionNote: null })
    } catch {
      setRow(key, { state: 'error', error: 'Upload failed. Tap to retry.' })
    }
  }

  const requiredKeys   = [...DRIVER_DOCS.filter(d => d.required).map(d => d.key), ...VEHICLE_DOCS.filter(d => d.required).map(d => d.key)]
  const allDocsUploaded = requiredKeys.every(k => docState[k]?.state === 'done')
  const identityFilled  = licenseNumber.trim().length > 0 && aadhaarNumber.length === 12
  const canContinue     = allDocsUploaded && (identitySaved || identityFilled)

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-40">

        {/* Step bar */}
        <div className="flex gap-1.5 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`} />
          ))}
        </div>

        {/* Back + title */}
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => navigate(-1)} className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center">
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <p className="text-text-muted text-xs">Step 3 of 4</p>
            <h1 className="text-xl font-bold">Documents</h1>
          </div>
        </div>
        <p className="text-text-muted text-xs mb-5">Progress is saved automatically</p>

        <div className="space-y-4">

          {/* ── Card 1: Identity Numbers ── */}
          <div className="driver-card">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-text-primary">Identity Numbers</h2>
              {identitySaved && <CheckCircle2 size={14} className="text-green-500 ml-auto flex-shrink-0" />}
            </div>
            <div className="space-y-4">
              <Field label="Driving Licence Number">
                <input
                  className="input-dark w-full font-mono uppercase"
                  placeholder="OD0519910012345"
                  value={licenseNumber}
                  onChange={e => { setLicenseNumber(e.target.value.toUpperCase()); setIdentitySaved(false) }}
                  onBlur={() => void handleIdentityBlur()}
                />
              </Field>
              <Field label="Aadhaar Number" hint="12-digit number on your Aadhaar card">
                <input
                  className="input-dark w-full font-mono tracking-widest"
                  placeholder="XXXXXXXXXXXX"
                  inputMode="numeric"
                  maxLength={12}
                  value={aadhaarNumber}
                  onChange={e => { setAadhaarNumber(e.target.value.replace(/\D/g, '').slice(0, 12)); setIdentitySaved(false) }}
                  onBlur={() => void handleIdentityBlur()}
                />
              </Field>
              {identityError && (
                <div className="flex items-center gap-2 bg-accent-red/10 border border-accent-red/20 rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="text-accent-red flex-shrink-0" />
                  <p className="text-accent-red text-xs font-medium">{identityError}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Card 2: Driver Documents ── */}
          <div className="driver-card">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-text-primary">Driver Documents</h2>
            </div>
            <div className="space-y-3">
              {DRIVER_DOCS.map((doc, i) => (
                <div key={doc.key}>
                  <DocCard
                    label={doc.label}
                    required={doc.required}
                    accept={doc.accept}
                    needsExpiry={doc.needsExpiry}
                    docState={docState[doc.key]!}
                    validUntil={validUntil[doc.key]}
                    inputRef={el => { fileRefs.current[doc.key] = el }}
                    onFileChange={file => void handleFileSelect(doc.key, false, file)}
                    onTrigger={() => fileRefs.current[doc.key]?.click()}
                    onValidUntilChange={val => setValidUntil(prev => ({ ...prev, [doc.key]: val }))}
                    onPreview={() => { const u = docState[doc.key]?.url; if (u) setPreview({ url: u, label: doc.label }) }}
                  />
                  {i < DRIVER_DOCS.length - 1 && <div className="mt-3 h-px bg-border" />}
                </div>
              ))}
            </div>
          </div>

          {/* ── Card 3: Vehicle Documents ── */}
          <div className="driver-card">
            <div className="flex items-center gap-2 mb-4">
              <Car size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-text-primary">Vehicle Documents</h2>
            </div>
            <div className="space-y-3">
              {VEHICLE_DOCS.map((doc, i) => (
                <div key={doc.key}>
                  <DocCard
                    label={doc.label}
                    required={doc.required}
                    accept={doc.accept}
                    needsExpiry={doc.needsExpiry}
                    docState={docState[doc.key]!}
                    validUntil={validUntil[doc.key]}
                    inputRef={el => { fileRefs.current[doc.key] = el }}
                    onFileChange={file => void handleFileSelect(doc.key, true, file)}
                    onTrigger={() => fileRefs.current[doc.key]?.click()}
                    onValidUntilChange={val => setValidUntil(prev => ({ ...prev, [doc.key]: val }))}
                    onPreview={() => { const u = docState[doc.key]?.url; if (u) setPreview({ url: u, label: doc.label }) }}
                  />
                  {i < VEHICLE_DOCS.length - 1 && <div className="mt-3 h-px bg-border" />}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Sticky footer CTA */}
      <div className="fixed bottom-0 left-0 right-0 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-sm border-t border-border z-20">
        {!canContinue && (
          <p className="text-text-muted text-xs text-center mb-2">
            {!identityFilled   ? 'Enter your licence and Aadhaar numbers to continue'
            : !allDocsUploaded ? 'Upload all required documents to continue'
            : ''}
          </p>
        )}
        <button
          onClick={async () => {
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
          }}
          disabled={!canContinue || isSaving}
          className="btn-go w-full"
          style={{ minHeight: 52 }}
        >
          {isSaving
            ? <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Saving…
              </span>
            : 'Continue to Selfie'}
        </button>
      </div>

      {/* In-app doc preview modal */}
      {preview && (
        <DocPreviewModal
          url={preview.url}
          label={preview.label}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  )
}

/* ─────────────── DocCard ─────────────── */

interface DocCardProps {
  label: string
  required: boolean
  accept: string
  needsExpiry: boolean
  docState: DocRowState
  validUntil?: string
  inputRef: (el: HTMLInputElement | null) => void
  onFileChange: (file: File) => void
  onTrigger: () => void
  onValidUntilChange?: (val: string) => void
  onPreview?: () => void
}

function DocCard({ label, required, accept, needsExpiry, docState, validUntil, inputRef, onFileChange, onTrigger, onValidUntilChange, onPreview }: DocCardProps) {
  const { state, url, error, docStatus, rejectionNote } = docState
  const isDone     = state === 'done'
  const isRejected = isDone && docStatus === 'rejected'
  const isUploading = state === 'uploading'
  const isError    = state === 'error'

  const formatExpiry = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div>
      <input
        type="file"
        accept={accept}
        className="hidden"
        ref={inputRef}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onFileChange(f); e.target.value = '' } }}
      />

      {isDone ? (
        /* ── Done state ── */
        <div className={`rounded-xl border px-3 py-3 flex items-center gap-3 ${
          isRejected ? 'border-amber-500/30 bg-amber-500/5' : 'border-green-500/30 bg-green-500/5'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isRejected ? 'bg-amber-500/15' : 'bg-green-500/15'
          }`}>
            {isRejected
              ? <AlertCircle size={18} className="text-amber-500" />
              : <CheckCircle2 size={18} className="text-green-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{label}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {docStatus === 'approved' && (
                <span className="text-[10px] font-bold text-green-500 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">Approved</span>
              )}
              {docStatus === 'pending' && !isRejected && (
                <span className="text-[10px] font-semibold text-text-muted bg-surface-3 px-2 py-0.5 rounded-full">Under review</span>
              )}
              {isRejected && (
                <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">Action needed</span>
              )}
              {validUntil && (
                <span className="text-[10px] text-text-muted">· Exp {formatExpiry(validUntil)}</span>
              )}
            </div>
            {isRejected && rejectionNote && (
              <p className="text-xs text-amber-600 mt-1.5 leading-snug">{rejectionNote}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {url && onPreview && (
              <button
                type="button"
                onClick={onPreview}
                className="w-9 h-9 rounded-xl bg-surface-3 border border-border flex items-center justify-center"
              >
                <Eye size={15} className="text-text-secondary" />
              </button>
            )}
            <button
              type="button"
              onClick={onTrigger}
              className="w-9 h-9 rounded-xl bg-surface-3 border border-border flex items-center justify-center"
            >
              <RefreshCw size={15} className="text-text-secondary" />
            </button>
          </div>
        </div>
      ) : (
        /* ── Upload / idle / error state ── */
        <div
          onClick={!isUploading ? onTrigger : undefined}
          className={`rounded-xl border-2 border-dashed px-3 py-3 flex items-center gap-3 transition-all ${
            isUploading ? 'border-primary/40 bg-primary/5 cursor-default'
            : isError   ? 'border-accent-red/40 bg-accent-red/5 cursor-pointer active:bg-accent-red/10'
            :             'border-border cursor-pointer active:bg-primary/5 hover:border-primary/40'
          }`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isUploading ? 'bg-primary/10'
            : isError   ? 'bg-accent-red/10'
            :             'bg-surface-3'
          }`}>
            {isUploading
              ? <Loader2 size={18} className="text-primary animate-spin" />
              : isError
                ? <AlertCircle size={18} className="text-accent-red" />
                : <Upload size={18} className="text-text-muted" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{label}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {isUploading ? 'Uploading…'
              : isError    ? (error ?? 'Upload failed. Tap to retry.')
              :              'Tap to upload · PDF or image · 20 MB'}
            </p>
          </div>
          {required && !isUploading && !isError && (
            <span className="flex-shrink-0 text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">
              Required
            </span>
          )}
        </div>
      )}

      {/* Expiry date — shown below upload or done row when needed */}
      {needsExpiry && (
        <div className="mt-2.5">
          <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1.5 block">
            Expiry Date <span className="text-accent-red">*</span>
          </label>
          <input
            type="date"
            className="input-dark w-full"
            value={validUntil ?? ''}
            onChange={e => onValidUntilChange?.(e.target.value)}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

/* ─────────────── DocPreviewModal ─────────────── */

function DocPreviewModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const isPdf = /\.pdf($|\?)/i.test(url) || url.includes('application%2Fpdf')

  return (
    <div className="fixed inset-0 z-[60] flex flex-col">
      {/* Dark backdrop */}
      <div className="absolute inset-0 bg-black/92" onClick={onClose} />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-12 pb-3">
        <p className="text-white text-sm font-semibold truncate flex-1 mr-3">{label}</p>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0"
        >
          <X size={18} className="text-white" />
        </button>
      </div>

      {/* Preview area */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 pb-10">
        {isPdf ? (
          <iframe
            src={url}
            title={label}
            className="w-full h-full rounded-2xl bg-white"
          />
        ) : (
          <img
            src={url}
            alt={label}
            className="max-w-full max-h-full object-contain rounded-2xl"
          />
        )}
      </div>

      {/* Bottom hint */}
      <div className="relative z-10 pb-8 flex justify-center">
        <p className="text-white/40 text-xs">Pinch to zoom · Tap outside to close</p>
      </div>
    </div>
  )
}
