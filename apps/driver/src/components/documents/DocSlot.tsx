import { Upload, CheckCircle2, AlertCircle, Eye, RefreshCw } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import type { SlotDef, SlotState } from './types'

interface DocSlotProps {
  slot: SlotDef
  state: SlotState
  inputRef: (el: HTMLInputElement | null) => void
  onTrigger: () => void
  onFileChange: (file: File) => void
  onPreview: () => void
}

export default function DocSlot({ slot, state, inputRef, onTrigger, onFileChange, onPreview }: DocSlotProps) {
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
          {/* Action row: in natural flow, no absolute crowding */}
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
