import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Eye, RefreshCw } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { onboardingApi } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'
import DatePickerSheet from '@/components/ui/DatePickerSheet'

const TODAY_ISO = new Date().toISOString().slice(0, 10)

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface DocRowState {
  state: UploadState
  url: string | null
  error: string | null
}

const VEHICLE_DOCS = [
  { key: 'vehicle_rc',     label: 'Registration Certificate (RC)',  required: true,  accept: 'image/*,application/pdf', needsExpiry: false },
  { key: 'insurance',      label: 'Insurance Certificate',          required: true,  accept: 'image/*,application/pdf', needsExpiry: true  },
  { key: 'permit',         label: 'Commercial Permit',              required: true,  accept: 'image/*,application/pdf', needsExpiry: true  },
  { key: 'pollution_cert', label: 'Pollution Certificate (PUC)',    required: false, accept: 'image/*,application/pdf', needsExpiry: true  },
  { key: 'fitness_cert',   label: 'Fitness Certificate',            required: false, accept: 'image/*,application/pdf', needsExpiry: true  },
] as const

function initDocState(): Record<string, DocRowState> {
  return Object.fromEntries(VEHICLE_DOCS.map(d => [d.key, { state: 'idle', url: null, error: null }]))
}

export default function VehicleDocuments() {
  const navigate = useNavigate()
  const driver = useAuthStore(s => s.driver)

  const [docState, setDocState] = useState<Record<string, DocRowState>>(initDocState)
  const [validUntil, setValidUntil] = useState<Record<string, string>>({})
  const [isFetching, setIsFetching] = useState(true)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const steps = ['personal_info', 'vehicle_info', 'documents', 'selfie']
  const stepIdx = steps.indexOf(driver?.onboarding_step ?? 'documents')

  useEffect(() => {
    const load = async () => {
      try {
        const status = await onboardingApi.getDocumentStatus()
        const merged: Record<string, DocRowState> = initDocState()
        for (const [k, v] of Object.entries(status.vehicle_docs)) {
          if (k in merged) merged[k] = { state: v.uploaded ? 'done' : 'idle', url: v.url, error: null }
        }
        setDocState(merged)
      } catch {
        // first time — start fresh
      } finally {
        setIsFetching(false)
      }
    }
    void load()
  }, [])

  const setRow = (key: string, patch: Partial<DocRowState>) =>
    setDocState(prev => ({ ...prev, [key]: { ...prev[key]!, ...patch } }))

  const handleTrigger = (key: string) => {
    fileRefs.current[key]?.click()
  }

  const handleFileSelect = async (key: string, file: File) => {
    setRow(key, { state: 'uploading', error: null })
    try {
      const result = await onboardingApi.uploadVehicleDoc(file, key, undefined, validUntil[key])
      setRow(key, { state: 'done', url: result.file_url, error: null })
    } catch {
      setRow(key, { state: 'error', error: 'Upload failed. Tap to retry.' })
    }
  }

  const requiredKeys = VEHICLE_DOCS.filter(d => d.required).map(d => d.key)
  const allDone = requiredKeys.every(k => docState[k]?.state === 'done')

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <OcarSpinner size={32} variant="color" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10">
      {/* Step bar */}
      <div className="flex gap-1.5 mb-8">
        {steps.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 3 of 4</p>
          <h1 className="text-xl font-bold">Vehicle Documents</h1>
        </div>
      </div>

      <p className="text-text-secondary text-sm mb-6 leading-relaxed">
        Upload your vehicle documents. RC, Insurance and Permit are required. Pollution and Fitness certificates are optional but recommended.
      </p>

      <div className="space-y-3 mb-8">
        {VEHICLE_DOCS.map(doc => (
          <DocCard
            key={doc.key}
            label={doc.label}
            required={doc.required}
            accept={doc.accept}
            needsExpiry={doc.needsExpiry}
            docState={docState[doc.key]!}
            validUntil={validUntil[doc.key]}
            inputRef={el => { fileRefs.current[doc.key] = el }}
            onFileChange={file => void handleFileSelect(doc.key, file)}
            onTrigger={() => handleTrigger(doc.key)}
            onValidUntilChange={val => setValidUntil(prev => ({ ...prev, [doc.key]: val }))}
          />
        ))}
      </div>

      {!allDone && (
        <p className="text-text-muted text-xs text-center mb-4">
          Upload all vehicle documents to continue.
        </p>
      )}

      <button
        onClick={() => navigate('/onboarding/selfie')}
        disabled={!allDone}
        className="btn-go w-full"
        style={{ minHeight: 56 }}
      >
        Continue
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
  inputRef: (el: HTMLInputElement | null) => void
  onFileChange: (file: File) => void
  onTrigger: () => void
  onValidUntilChange?: (val: string) => void
}

function DocCard({ label, required, accept, needsExpiry, docState, validUntil, inputRef, onFileChange, onTrigger, onValidUntilChange }: DocCardProps) {
  const { state, url, error } = docState
  const isDone = state === 'done'

  const formatExpiry = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className={`rounded-2xl border p-4 transition-all ${
      isDone ? 'border-green-500/40 bg-green-500/5' : 'border-border bg-surface-2'
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
              <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-green-700">{label}</p>
                {validUntil && <p className="text-xs text-text-muted">Expires {formatExpiry(validUntil)}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {url && (
                <button
                  type="button"
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-green-700 bg-green-500/10 border border-green-500/20"
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
          {needsExpiry && (
            <div className="mt-3">
              <label className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Expiry Date {required && <span className="text-accent-red">*</span>}
              </label>
              <DatePickerSheet
                label="Expiry Date"
                value={validUntil ?? ''}
                onChange={v => onValidUntilChange?.(v)}
                minDate={TODAY_ISO}
                placeholder="Select expiry date"
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
              ? <OcarSpinner size={22} variant="color" />
              : state === 'error'
                ? <AlertCircle size={22} className="text-accent-red" />
                : <Upload size={22} className="text-text-muted" />}
            <p className="text-xs text-text-muted text-center px-4">
              {state === 'uploading' ? 'Uploading…'
               : state === 'error'   ? (error ?? 'Upload failed. Tap to retry.')
               : 'Tap to upload · PDF or image · 20MB max'}
            </p>
          </div>

          {needsExpiry && (
            <div className="mt-3">
              <label className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Expiry Date {required && <span className="text-accent-red">*</span>}
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
        </>
      )}
    </div>
  )
}
