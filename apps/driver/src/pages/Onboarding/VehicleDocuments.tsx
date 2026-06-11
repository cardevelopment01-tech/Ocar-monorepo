import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2, Eye } from 'lucide-react'
import { onboardingApi } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface DocRowState {
  state: UploadState
  url: string | null
  error: string | null
}

const VEHICLE_DOCS = [
  { key: 'vehicle_rc', label: 'Registration Certificate (RC)', required: true,  accept: 'image/*,application/pdf' },
  { key: 'insurance',  label: 'Insurance Certificate',         required: true,  accept: 'image/*,application/pdf' },
  { key: 'permit',     label: 'Commercial Permit',             required: true,  accept: 'image/*,application/pdf' },
] as const

function initDocState(): Record<string, DocRowState> {
  return Object.fromEntries(VEHICLE_DOCS.map(d => [d.key, { state: 'idle', url: null, error: null }]))
}

export default function VehicleDocuments() {
  const navigate = useNavigate()
  const driver = useAuthStore(s => s.driver)

  const [docState, setDocState] = useState<Record<string, DocRowState>>(initDocState)
  const [isFetching, setIsFetching] = useState(true)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const steps = ['personal_info', 'vehicle_info', 'documents', 'vehicle_docs', 'selfie']
  const stepIdx = steps.indexOf(driver?.onboarding_step ?? 'vehicle_docs')

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

  const handleFileSelect = async (key: string, file: File) => {
    setRow(key, { state: 'uploading', error: null })
    try {
      const result = await onboardingApi.uploadVehicleDoc(file, key)
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
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
        <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 4 of 5</p>
          <h1 className="text-xl font-bold">Vehicle Documents</h1>
        </div>
      </div>

      <p className="text-text-secondary text-sm mb-6 leading-relaxed">
        Upload your vehicle documents. All three are required to submit your application.
      </p>

      <div className="space-y-2 mb-8">
        {VEHICLE_DOCS.map(doc => (
          <DocUploadRow
            key={doc.key}
            label={doc.label}
            required={doc.required}
            accept={doc.accept}
            docState={docState[doc.key]!}
            inputRef={el => { fileRefs.current[doc.key] = el }}
            onFileChange={file => void handleFileSelect(doc.key, file)}
            onTrigger={() => fileRefs.current[doc.key]?.click()}
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

interface DocUploadRowProps {
  label: string
  required: boolean
  accept: string
  docState: DocRowState
  inputRef: (el: HTMLInputElement | null) => void
  onFileChange: (file: File) => void
  onTrigger: () => void
}

function DocUploadRow({ label, required, accept, docState, inputRef, onFileChange, onTrigger }: DocUploadRowProps) {
  const { state, url, error } = docState

  return (
    <div
      className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
        state === 'done'        ? 'border-green-500/40 bg-green-500/5'
        : state === 'error'     ? 'border-accent-red/40 bg-accent-red/5'
        : state === 'uploading' ? 'border-primary/40 bg-primary/5'
        : 'border-border bg-surface-2'
      }`}
      onClick={state !== 'uploading' ? onTrigger : undefined}
    >
      <input
        type="file"
        accept={accept}
        className="hidden"
        ref={inputRef}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) { onFileChange(file); e.target.value = '' }
        }}
      />

      <div className="flex-shrink-0">
        {state === 'uploading' && <Loader2 size={20} className="text-primary animate-spin" />}
        {state === 'done'      && <CheckCircle2 size={20} className="text-green-500" />}
        {state === 'error'     && <AlertCircle size={20} className="text-accent-red" />}
        {state === 'idle'      && <Upload size={20} className="text-text-muted" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-semibold ${state === 'done' ? 'text-green-400' : 'text-text-primary'}`}>
            {label}
          </p>
          {required && state !== 'done' && <span className="text-accent-red text-xs">*</span>}
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          {state === 'uploading' && 'Uploading…'}
          {state === 'done'      && 'Uploaded · tap to replace'}
          {state === 'error'     && (error ?? 'Upload failed — tap to retry')}
          {state === 'idle'      && 'Tap to upload'}
        </p>
      </div>

      {state === 'done' && url && (
        <button
          type="button"
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 border border-green-500/20 transition-colors active:bg-green-500/20"
          onClick={e => { e.stopPropagation(); window.open(url, '_blank', 'noopener,noreferrer') }}
        >
          <Eye size={13} strokeWidth={2} />
          View
        </button>
      )}
    </div>
  )
}
