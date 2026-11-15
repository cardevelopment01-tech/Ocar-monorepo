'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { UploadCloud, FileText, X, AlertTriangle, Loader2 } from 'lucide-react'
import SlideOver from '@/components/ui/SlideOver'
import { adminDriverApi } from '@/lib/admin-api'
import { extractErrorMessage, extractErrorCode } from '@/lib/http-errors'
import {
  REASON_PRESETS, needsExpiry, minExpiryIso, validateUploadFile, uploadBlocker, ACCEPTED_TYPES,
} from '@/lib/doc-upload-model'
import { docLabel } from '@/app/(dashboard)/drivers/shared'
import { cn } from '@/lib/utils'

export interface UploadTarget {
  kind: 'driver' | 'vehicle'
  docType: string
  /** The document already in this slot, if any (drives the replace warning and the version check). */
  existing: { status: string; fileUrl: string; updatedAt: string; uploadedByEmail: string | null } | null
}

interface Props {
  driverId: string
  target: UploadTarget | null
  onClose: () => void
  /** Called after a successful upload with a short message; the page reloads the driver. */
  onDone: (message: string) => void
  /** Called when the document changed under the admin (409), so the page can reload. */
  onStale: () => void
}

export default function UploadDocDrawer({ driverId, target, onClose, onDone, onStale }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [expiry, setExpiry] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [reason, setReason] = useState('')
  const [ticket, setTicket] = useState('')
  const [confirmSelfie, setConfirmSelfie] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<'review' | 'approve' | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // A fresh form every time the drawer opens on a slot.
  useEffect(() => {
    setFile(null); setFileError(''); setExpiry(''); setDocNumber(''); setReason(''); setTicket('')
    setConfirmSelfie(false); setBusy(null); setError('')
  }, [target?.kind, target?.docType])

  const previewUrl = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  if (!target) return <SlideOver isOpen={false} onClose={onClose} title="">{null}</SlideOver>
  const { docType, existing } = target
  const state = { file, expiry, reason, confirmSelfie }
  const reviewBlocker = uploadBlocker(docType, state, false)
  const approveBlocker = uploadBlocker(docType, state, true)

  function pick(f: File | undefined) {
    if (!f) return
    const problem = validateUploadFile(f)
    setFileError(problem ?? '')
    setFile(problem ? null : f)
  }

  async function submit(approve: boolean) {
    if (!file || busy) return
    setBusy(approve ? 'approve' : 'review'); setError('')
    try {
      const fields: Parameters<typeof adminDriverApi.uploadDocument>[1] = {
        kind: target!.kind, doc_type: docType, reason: reason.trim(), approve,
      }
      if (ticket.trim()) fields.ticket_ref = ticket.trim()
      if (needsExpiry(docType) && expiry) fields.valid_until = expiry
      if (approve && needsExpiry(docType)) fields.verified_valid_until = expiry
      if (docNumber.trim()) fields.doc_number = docNumber.trim()
      if (existing) fields.seen_updated_at = existing.updatedAt
      if (docType === 'profile_photo') fields.confirm_reference_selfie = true
      const res = await adminDriverApi.uploadDocument(driverId, fields, file)
      onDone(
        res.submitted ? `${docLabel(docType)} saved. The application is now with approvals.`
        : res.status === 'approved' ? `${docLabel(docType)} uploaded and approved.`
        : `${docLabel(docType)} uploaded and waiting for review.`,
      )
    } catch (err) {
      if (extractErrorCode(err) === 'DOC_CHANGED') { onStale(); setError('This document changed while you were working. The page has been refreshed. Check it and try again.') }
      else setError(extractErrorMessage(err, 'Could not upload the document. Please try again.'))
      setBusy(null)
    }
  }

  const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20'
  const labelCls = 'block text-xs font-semibold text-text-secondary mb-1.5'

  return (
    <SlideOver isOpen onClose={() => { if (!busy) onClose() }} title={`${existing ? 'Replace' : 'Upload'} ${docLabel(docType)}`}>
      <div className="flex flex-col min-h-full">
        <div className="flex-1 px-6 py-5 space-y-5">
          <p className="text-xs text-text-muted">
            You are uploading this on the driver&apos;s behalf. It is recorded against your account and the driver is told.
          </p>

          {existing?.status === 'approved' && (
            <div className="flex items-start gap-2.5 bg-warning/10 border border-warning/30 rounded-xl px-3.5 py-3">
              <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
              <div className="text-xs text-text-secondary">
                <p className="font-semibold text-text-primary">This replaces an approved document.</p>
                <p className="mt-0.5">It goes back to pending unless you choose Upload &amp; approve. While it is pending, an active driver is taken offline and cannot go online.</p>
                <a href={existing.fileUrl} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline mt-1 inline-block">View current file</a>
              </div>
            </div>
          )}
          {existing && existing.status !== 'approved' && existing.uploadedByEmail && (
            <p className="text-xs text-text-muted">Current file was uploaded by {existing.uploadedByEmail}.</p>
          )}

          {/* File */}
          <div>
            <span className={labelCls}>File</span>
            {file ? (
              <div className="flex items-center gap-3 border border-border rounded-xl p-3 bg-surface-2">
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-surface-3 flex items-center justify-center flex-shrink-0">
                  {previewUrl
                    ? <img src={previewUrl} alt="Selected file preview" className="w-full h-full object-cover" />
                    : <FileText size={22} className="text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                  <p className="text-xs text-text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button type="button" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = '' }} disabled={!!busy}
                  className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3" aria-label="Remove file">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}
                className={cn(
                  'flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 bg-surface-2/50',
                )}
              >
                <UploadCloud size={24} className="text-text-muted" />
                <span className="text-sm font-medium text-text-primary">Drop the file here or click to choose</span>
                <span className="text-xs text-text-muted">JPG, PNG or PDF, up to 10 MB</span>
                <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" onChange={e => pick(e.target.files?.[0])} />
              </label>
            )}
            {fileError && <p className="text-xs text-danger mt-1.5" role="alert">{fileError}</p>}
          </div>

          {/* Details */}
          {needsExpiry(docType) && (
            <div>
              <label htmlFor="upload-expiry" className={labelCls}>Expiry date on the document</label>
              <input id="upload-expiry" type="date" value={expiry} min={minExpiryIso()} onChange={e => setExpiry(e.target.value)} className={cn(inputCls, 'sm:w-56')} />
              <p className="text-xs text-text-muted mt-1">Needed to approve now. You can leave it empty if you upload for review.</p>
            </div>
          )}
          {target.kind === 'vehicle' && (
            <div>
              <label htmlFor="upload-docno" className={labelCls}>Document number <span className="font-normal text-text-muted">(optional)</span></label>
              <input id="upload-docno" value={docNumber} maxLength={80} onChange={e => setDocNumber(e.target.value)} className={inputCls} />
            </div>
          )}

          {/* Why */}
          <div>
            <label htmlFor="upload-reason" className={labelCls}>Why are you uploading this?</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {REASON_PRESETS.map(p => (
                <button key={p} type="button" onClick={() => setReason(p === 'Other' ? '' : p)}
                  className={cn('px-2.5 py-1 rounded-full text-xs border transition-colors',
                    reason === p ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary hover:border-primary/40')}>
                  {p}
                </button>
              ))}
            </div>
            <textarea id="upload-reason" rows={2} value={reason} maxLength={300} onChange={e => setReason(e.target.value)}
              placeholder="Required. Kept in the audit log." className={inputCls} />
            <input value={ticket} maxLength={80} onChange={e => setTicket(e.target.value)} placeholder="Support ticket or call reference (optional)" className={cn(inputCls, 'mt-2')} />
          </div>

          {docType === 'profile_photo' && (
            <label className="flex items-start gap-2.5 border border-warning/30 bg-warning/10 rounded-xl px-3.5 py-3 cursor-pointer">
              <input type="checkbox" checked={confirmSelfie} onChange={e => setConfirmSelfie(e.target.checked)} className="mt-0.5" />
              <span className="text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">This photo becomes the driver&apos;s reference selfie.</span>{' '}
                Daily identity checks compare the driver&apos;s selfie against it.
              </span>
            </label>
          )}
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 border-t border-border bg-surface px-6 py-4 space-y-2.5">
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          {!error && (approveBlocker && reviewBlocker ? <p className="text-xs text-text-muted">{reviewBlocker}</p> : null)}
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => submit(false)} disabled={!!reviewBlocker || !!busy}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {busy === 'review' && <Loader2 size={14} className="animate-spin" />}Upload for review
            </button>
            <button type="button" onClick={() => submit(true)} disabled={!!approveBlocker || !!busy}
              title={!reviewBlocker && approveBlocker ? approveBlocker : undefined}
              className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {busy === 'approve' && <Loader2 size={14} className="animate-spin" />}Upload &amp; approve
            </button>
          </div>
          {!reviewBlocker && approveBlocker && <p className="text-xs text-text-muted">{approveBlocker}</p>}
        </div>
      </div>
    </SlideOver>
  )
}
