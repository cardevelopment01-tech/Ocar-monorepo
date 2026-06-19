import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2, Eye, RefreshCw } from 'lucide-react'
import { onboardingApi, type DocumentStatus } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface DocRowState {
  state: UploadState
  url: string | null
  error: string | null
  docStatus: string | null      // backend status: 'pending' | 'approved' | 'rejected'
  rejectionNote: string | null
}

const DRIVER_DOCS = [
  { key: 'driving_license', label: 'Driving Licence', required: true, accept: 'image/*,application/pdf', needsExpiry: true  },
  { key: 'aadhaar_front',   label: 'Aadhaar Front',   required: true, accept: 'image/*',                  needsExpiry: false },
  { key: 'aadhaar_back',    label: 'Aadhaar Back',    required: true, accept: 'image/*',                  needsExpiry: false },
] as const

const VEHICLE_DOCS = [
  { key: 'vehicle_rc', label: 'Vehicle RC', required: true, accept: 'image/*,application/pdf', needsExpiry: true  },
  { key: 'insurance',  label: 'Insurance',  required: true, accept: 'image/*,application/pdf', needsExpiry: true  },
  { key: 'permit',     label: 'Permit',     required: true, accept: 'image/*,application/pdf', needsExpiry: true  },
] as const

function initDocState(): Record<string, DocRowState> {
  const keys = [...DRIVER_DOCS.map(d => d.key), ...VEHICLE_DOCS.map(d => d.key)]
  return Object.fromEntries(keys.map(k => [k, { state: 'idle', url: null, error: null, docStatus: null, rejectionNote: null }]))
}

const STEPS = ['personal_info', 'vehicle_info', 'documents', 'selfie']

export default function Documents() {
  const navigate = useNavigate()
  const driver = useAuthStore(s => s.driver)

  const [licenseNumber, setLicenseNumber] = useState('')
  const [aadhaarNumber, setAadhaarNumber] = useState('')
  const [identitySaved, setIdentitySaved] = useState(false)
  const [identityError, setIdentityError] = useState('')

  const [docState, setDocState] = useState<Record<string, DocRowState>>(initDocState)
  const [validUntil, setValidUntil] = useState<Record<string, string>>({})
  const [expiryErrors] = useState<Record<string, string>>({})
  const [isFetching, setIsFetching] = useState(true)

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
          if (k in merged) merged[k] = {
            state: v.uploaded ? 'done' : 'idle',
            url: v.url,
            error: null,
            docStatus: v.status,
            rejectionNote: v.rejection_note,
          }
        }
        for (const [k, v] of Object.entries(status.vehicle_docs)) {
          if (k in merged) merged[k] = {
            state: v.uploaded ? 'done' : 'idle',
            url: v.url,
            error: null,
            docStatus: v.status,
            rejectionNote: v.rejection_note,
          }
        }
        setDocState(merged)
      } catch {
        // first-time driver — start fresh
      } finally {
        setIsFetching(false)
      }
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
      setIdentityError('Could not save — check your details.')
    }
  }

  const setRow = (key: string, patch: Partial<DocRowState>) =>
    setDocState(prev => ({ ...prev, [key]: { ...prev[key]!, ...patch } }))

  const handleTrigger = (key: string) => {
    fileRefs.current[key]?.click()
  }

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

  const requiredKeys = [
    ...DRIVER_DOCS.filter(d => d.required).map(d => d.key),
    ...VEHICLE_DOCS.filter(d => d.required).map(d => d.key),
  ]

  const allDocsUploaded = requiredKeys.every(k => docState[k]?.state === 'done')
  const identityFilled = licenseNumber.trim().length > 0 && aadhaarNumber.length === 12
  const canContinue = allDocsUploaded && (identitySaved || identityFilled)

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10">
      {/* Step bar — 4 steps now */}
      <div className="flex gap-1.5 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 3 of 4</p>
          <h1 className="text-xl font-bold">Documents</h1>
        </div>
      </div>

      {/* Identity numbers */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider">Identity Numbers</p>
          {identitySaved && <CheckCircle2 size={16} className="text-green-500" />}
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 block">Driving Licence Number</label>
            <input
              className="input-dark w-full font-mono uppercase"
              placeholder="OD0519910012345"
              value={licenseNumber}
              onChange={e => { setLicenseNumber(e.target.value.toUpperCase()); setIdentitySaved(false) }}
              onBlur={() => void handleIdentityBlur()}
            />
          </div>
          <div>
            <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 block">Aadhaar Number</label>
            <input
              className="input-dark w-full font-mono"
              placeholder="XXXXXXXXXXXX"
              inputMode="numeric"
              maxLength={12}
              value={aadhaarNumber}
              onChange={e => { setAadhaarNumber(e.target.value.replace(/\D/g, '').slice(0, 12)); setIdentitySaved(false) }}
              onBlur={() => void handleIdentityBlur()}
            />
          </div>
          {identityError && <p className="text-accent-red text-xs">{identityError}</p>}
        </div>
      </section>

      {/* Driver documents */}
      <section className="mb-6">
        <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">Driver Documents</p>
        <div className="space-y-3">
          {DRIVER_DOCS.map(doc => (
            <DocCard
              key={doc.key}
              label={doc.label}
              required={doc.required}
              accept={doc.accept}
              needsExpiry={doc.needsExpiry}
              docState={docState[doc.key]!}
              validUntil={validUntil[doc.key]}
              expiryError={expiryErrors[doc.key]}
              inputRef={el => { fileRefs.current[doc.key] = el }}
              onFileChange={file => void handleFileSelect(doc.key, false, file)}
              onTrigger={() => handleTrigger(doc.key)}
              onValidUntilChange={val => setValidUntil(prev => ({ ...prev, [doc.key]: val }))}
            />
          ))}
        </div>
      </section>

      {/* Vehicle documents */}
      <section className="mb-8">
        <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">Vehicle Documents</p>
        <div className="space-y-3">
          {VEHICLE_DOCS.map(doc => (
            <DocCard
              key={doc.key}
              label={doc.label}
              required={doc.required}
              accept={doc.accept}
              needsExpiry={doc.needsExpiry}
              docState={docState[doc.key]!}
              validUntil={validUntil[doc.key]}
              expiryError={expiryErrors[doc.key]}
              inputRef={el => { fileRefs.current[doc.key] = el }}
              onFileChange={file => void handleFileSelect(doc.key, true, file)}
              onTrigger={() => handleTrigger(doc.key)}
              onValidUntilChange={val => setValidUntil(prev => ({ ...prev, [doc.key]: val }))}
            />
          ))}
        </div>
      </section>

      {!canContinue && (
        <p className="text-text-muted text-xs text-center mb-4">
          Upload all documents and save your identity numbers to continue.
        </p>
      )}

      <button
        onClick={async () => {
          if (!identitySaved && identityFilled) {
            setIdentityError('')
            try {
              await onboardingApi.saveIdentityNumbers({
                license_number: licenseNumber.trim().toUpperCase(),
                aadhaar_number: aadhaarNumber,
              })
              setIdentitySaved(true)
            } catch {
              setIdentityError('Could not save — check your details.')
              return
            }
          }
          navigate('/onboarding/selfie')
        }}
        disabled={!canContinue}
        className="btn-go w-full"
        style={{ minHeight: 56 }}
      >
        Continue to Selfie
      </button>
    </div>
  )
}

interface DocCardProps {
  label: string
  required: boolean
  accept: string
  needsExpiry: boolean
  docState: DocRowState
  validUntil?: string
  expiryError?: string
  inputRef: (el: HTMLInputElement | null) => void
  onFileChange: (file: File) => void
  onTrigger: () => void
  onValidUntilChange?: (val: string) => void
}

function DocCard({ label, required, accept, needsExpiry, docState, validUntil, expiryError, inputRef, onFileChange, onTrigger, onValidUntilChange }: DocCardProps) {
  const { state, url, error, docStatus, rejectionNote } = docState
  const isDone = state === 'done'
  const isRejected = isDone && docStatus === 'rejected'

  const formatExpiry = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className={`rounded-2xl border p-4 transition-all ${
      isRejected ? 'border-amber-500/40 bg-amber-500/5'
      : isDone    ? 'border-green-500/40 bg-green-500/5'
      : 'border-border bg-surface-2'
    }`}>
      <input
        type="file"
        accept={accept}
        className="hidden"
        ref={inputRef}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onFileChange(f); e.target.value = '' } }}
      />

      {isDone ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {isRejected
                ? <AlertCircle size={18} className="text-amber-500 flex-shrink-0" />
                : <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />}
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${isRejected ? 'text-amber-400' : 'text-green-400'}`}>{label}</p>
                {validUntil && <p className="text-xs text-text-muted">Expires {formatExpiry(validUntil)}</p>}
                {docStatus === 'approved' && !isRejected && <p className="text-xs text-green-500/80">Approved</p>}
                {docStatus === 'pending'  && !isRejected && <p className="text-xs text-text-muted">Pending review</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {url && (
                <button
                  type="button"
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                    isRejected
                      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                      : 'text-green-400 bg-green-500/10 border-green-500/20'
                  }`}
                >
                  <Eye size={12} /> View
                </button>
              )}
              <button
                type="button"
                onClick={onTrigger}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-text-secondary bg-surface-3 border border-border"
              >
                <RefreshCw size={12} /> Replace
              </button>
            </div>
          </div>
          {isRejected && rejectionNote && (
            <p className="text-xs text-amber-400/90 mt-2 ml-7">{rejectionNote}</p>
          )}
          {needsExpiry && (
            <div className="mt-3">
              <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Expiry Date <span className="text-accent-red">*</span>
              </label>
              <input
                type="date"
                className="input-dark w-full"
                value={validUntil ?? ''}
                onChange={e => onValidUntilChange?.(e.target.value)}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-text-primary">{label}</p>
            {required && <span className="text-accent-red text-xs font-semibold">Required</span>}
          </div>

          <div
            onClick={state !== 'uploading' ? onTrigger : undefined}
            className={`rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-6 transition-all ${
              state === 'uploading' ? 'border-primary/40 bg-primary/5 cursor-default'
              : state === 'error'   ? 'border-accent-red/40 bg-accent-red/5 cursor-pointer'
              : 'border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer'
            }`}
          >
            {state === 'uploading'
              ? <Loader2 size={22} className="text-primary animate-spin" />
              : state === 'error'
                ? <AlertCircle size={22} className="text-accent-red" />
                : <Upload size={22} className="text-text-muted" />}
            <p className="text-xs text-text-muted text-center px-4">
              {state === 'uploading' ? 'Uploading…'
               : state === 'error'   ? (error ?? 'Upload failed — tap to retry')
               : 'Tap to upload · PDF or image · 5MB max'}
            </p>
          </div>

          {needsExpiry && (
            <div className="mt-3">
              <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Expiry Date <span className="text-accent-red">*</span>
              </label>
              <input
                type="date"
                className={`input-dark w-full ${expiryError ? 'border-accent-red' : ''}`}
                value={validUntil ?? ''}
                onChange={e => onValidUntilChange?.(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              {expiryError && <p className="text-accent-red text-xs mt-1">{expiryError}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
