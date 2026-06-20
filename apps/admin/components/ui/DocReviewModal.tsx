'use client'
import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, AlertCircle,
  FileText, ZoomIn, ZoomOut, ExternalLink,
} from 'lucide-react'
import type { DriverDetail } from '@/lib/admin-api'
import StatusPill from './StatusPill'
import { cn } from '@/lib/utils'

// ─── types ────────────────────────────────────────────────────────────────────

interface FlatDoc {
  kind: 'driver' | 'vehicle'
  docType: string
  fileUrl: string
  status: string
  rejectionNote: string | null
  id?: string
}

export interface DocReviewModalProps {
  detail: DriverDetail
  initialDocIndex?: number
  onClose: () => void
  onDriverAction: (type: 'approve' | 'rejectDocs' | 'ban' | 'suspend' | 'reinstate', reason?: string) => Promise<void>
  onDriverDocApprove: (docId: string) => Promise<void>
  onDriverDocReject: (docId: string, reason: string) => Promise<void>
  onVehicleDocApprove: (docId: string) => Promise<void>
  onVehicleDocReject: (docId: string, reason: string) => Promise<void>
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const DOC_LABELS: Record<string, string> = {
  profile_photo:   'Profile Photo',
  driving_license: 'Driving Licence',
  aadhaar_front:   'Aadhaar (Front)',
  aadhaar_back:    'Aadhaar (Back)',
  vehicle_rc:      'RC Book',
  insurance:       'Insurance',
  permit:          'Commercial Permit',
}
const label = (k: string) => DOC_LABELS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const REQUIRED_DRIVER  = ['profile_photo', 'driving_license', 'aadhaar_front', 'aadhaar_back']
const REQUIRED_VEHICLE = ['vehicle_rc', 'insurance', 'permit']

function buildDocs(d: DriverDetail): FlatDoc[] {
  const list: FlatDoc[] = []
  const addedD = new Set<string>()
  const addedV = new Set<string>()
  for (const x of d.documents)         { list.push({ kind: 'driver',  docType: x.doc_type, fileUrl: x.file_url, status: x.status, rejectionNote: x.rejection_note, id: x.id }); addedD.add(x.doc_type) }
  for (const x of d.vehicle_documents) { list.push({ kind: 'vehicle', docType: x.doc_type, fileUrl: x.file_url, status: x.status, rejectionNote: x.rejection_note, id: x.id }); addedV.add(x.doc_type) }
  for (const k of REQUIRED_DRIVER)  if (!addedD.has(k)) list.push({ kind: 'driver',  docType: k, fileUrl: '', status: 'missing', rejectionNote: null })
  for (const k of REQUIRED_VEHICLE) if (!addedV.has(k)) list.push({ kind: 'vehicle', docType: k, fileUrl: '', status: 'missing', rejectionNote: null })
  return list
}

// ─── Sidebar doc item ─────────────────────────────────────────────────────────

function SidebarDoc({ doc, selected, idx, total, onClick }: {
  doc: FlatDoc; selected: boolean; idx: number; total: number; onClick: () => void
}) {
  const isMissing = !doc.fileUrl || doc.status === 'missing'
  const isPdf = doc.fileUrl && /\.pdf(\?|$)/i.test(doc.fileUrl)

  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-3 px-3 py-2.5 text-left border-l-2 transition-all duration-100',
        selected
          ? 'bg-primary/8 border-l-primary'
          : 'border-l-transparent hover:bg-black/4 hover:border-l-border'
      )}
    >
      {/* Thumbnail */}
      <div className="relative w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-black/8">
        {isMissing ? (
          <div className="w-full h-full bg-surface-3 flex items-center justify-center">
            <FileText size={13} className="text-text-muted" />
          </div>
        ) : isPdf ? (
          <div className="w-full h-full bg-red-50 flex items-center justify-center">
            <FileText size={13} className="text-red-400" />
          </div>
        ) : (
          <img src={doc.fileUrl} alt={label(doc.docType)} className="w-full h-full object-cover" loading="lazy" />
        )}
      </div>

      {/* Label + status */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-[11px] font-semibold truncate leading-snug',
          selected ? 'text-primary' : 'text-text-primary'
        )}>
          {label(doc.docType)}
        </p>
        <p className={cn('text-[10px] mt-0.5 capitalize leading-none',
          doc.status === 'approved' ? 'text-success' :
          doc.status === 'rejected' ? 'text-danger'  :
          doc.status === 'pending' && doc.fileUrl ? 'text-warning' : 'text-text-muted'
        )}>
          {isMissing ? 'Not uploaded' : doc.status}
        </p>
      </div>

      {/* Status dot */}
      <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors',
        doc.status === 'approved'               ? 'bg-success' :
        doc.status === 'rejected'               ? 'bg-danger'  :
        doc.status === 'pending' && doc.fileUrl ? 'bg-warning' : 'bg-border'
      )} />
    </button>
  )
}

// ─── Inline reason form ───────────────────────────────────────────────────────

function ReasonForm({ title, placeholder, confirmLabel, danger, loading, onSubmit, onCancel }: {
  title: string; placeholder: string; confirmLabel: string; danger?: boolean
  loading: boolean; onSubmit: (r: string) => void; onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const valid = value.trim().length >= 10
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        rows={2}
        autoFocus
        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-text-muted text-text-primary leading-relaxed"
      />
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => onSubmit(value.trim())}
          disabled={!valid || loading}
          className={cn(
            'px-4 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-45',
            danger ? 'bg-danger text-white hover:bg-red-600' : 'bg-warning text-white hover:bg-amber-600'
          )}
        >
          {loading ? 'Submitting…' : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors"
        >
          Cancel
        </button>
        <span className="ml-auto text-xs text-text-muted tabular-nums">{value.trim().length}/10</span>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function DocReviewModal({
  detail, initialDocIndex = 0, onClose, onDriverAction,
  onDriverDocApprove, onDriverDocReject,
  onVehicleDocApprove, onVehicleDocReject,
}: DocReviewModalProps) {
  const allDocs = buildDocs(detail)

  const [idx, setIdx]                     = useState(() => Math.min(initialDocIndex, Math.max(0, allDocs.length - 1)))
  const [zoomFit, setZoomFit]             = useState(true)
  const [imgLoaded, setImgLoaded]         = useState(false)
  const [docLoading, setDocLoading]       = useState(false)
  const [driverLoading, setDriverLoading] = useState(false)
  const [rejectDoc, setRejectDoc]         = useState(false)
  const [driverMode, setDriverMode]       = useState<'rejectDocs' | 'ban' | 'suspend' | null>(null)
  const [mounted, setMounted]             = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setRejectDoc(false); setZoomFit(true); setImgLoaded(false) }, [idx])

  // Keyboard nav
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.key === 'Escape') {
        if (rejectDoc || driverMode) { setRejectDoc(false); setDriverMode(null) }
        else onClose()
      }
      if (e.key === 'ArrowLeft'  && idx > 0)                  setIdx(i => i - 1)
      if (e.key === 'ArrowRight' && idx < allDocs.length - 1) setIdx(i => i + 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [idx, allDocs.length, onClose, rejectDoc, driverMode])

  const doc       = allDocs[idx]
  const isMissing = !doc?.fileUrl || doc.status === 'missing'
  const isPdf     = doc?.fileUrl && /\.pdf(\?|$)/i.test(doc.fileUrl)
  const canApprove = !!doc?.id && doc.status !== 'approved' && !isMissing
  const canReject  = !!doc?.id && doc.status !== 'rejected' && !isMissing

  const approvedCount = allDocs.filter(d => d.status === 'approved').length
  const totalUploaded = allDocs.filter(d => d.fileUrl && d.status !== 'missing').length

  async function doDocApprove() {
    if (!doc?.id) return
    setDocLoading(true)
    try {
      if (doc.kind === 'driver') await onDriverDocApprove(doc.id)
      else                       await onVehicleDocApprove(doc.id)
    } finally { setDocLoading(false) }
  }
  async function doDocReject(reason: string) {
    if (!doc?.id) return
    setDocLoading(true)
    try {
      if (doc.kind === 'driver') await onDriverDocReject(doc.id, reason)
      else                       await onVehicleDocReject(doc.id, reason)
      setRejectDoc(false)
    } finally { setDocLoading(false) }
  }
  async function doDriverAction(type: 'approve' | 'rejectDocs' | 'ban' | 'suspend' | 'reinstate', reason?: string) {
    setDriverLoading(true)
    try { await onDriverAction(type, reason); onClose() } finally { setDriverLoading(false) }
  }

  if (!mounted || !doc) return null

  // ── progress bar fill ──────────────────────────────────────────────────────
  const progressPct = totalUploaded > 0 ? Math.round((approvedCount / totalUploaded) * 100) : 0

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-black/72 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 20 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full sm:rounded-2xl bg-surface shadow-2xl flex flex-col overflow-hidden"
        style={{ maxWidth: 1060, height: 'min(92vh, 740px)', zIndex: 1 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Document Review"
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border flex-shrink-0">
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-surface-2 transition-colors text-text-muted hover:text-text-primary flex-shrink-0"
          >
            <X size={15} />
          </button>

          <div className="w-px h-4 bg-border mx-0.5 flex-shrink-0" />

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{detail.full_name ?? detail.phone}</p>
            <code className="text-[11px] text-text-muted hidden sm:block">{detail.code}</code>
            <StatusPill status={detail.status} />
          </div>

          {/* Application actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {detail.status === 'pending_approval' && !driverMode && (
              <>
                <button
                  onClick={() => void doDriverAction('approve')}
                  disabled={driverLoading}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-success text-white text-xs font-bold rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  <CheckCircle size={13} /> Approve
                </button>
                <button
                  onClick={() => setDriverMode('rejectDocs')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 border border-warning/60 text-warning text-xs font-bold rounded-xl hover:bg-warning/8 transition-colors"
                >
                  Reject Docs
                </button>
                <button
                  onClick={() => setDriverMode('ban')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 border border-danger/60 text-danger text-xs font-bold rounded-xl hover:bg-danger/8 transition-colors"
                >
                  <XCircle size={13} /> Ban
                </button>
              </>
            )}
            {detail.status === 'active' && !driverMode && (
              <button onClick={() => setDriverMode('suspend')} className="px-3.5 py-1.5 border border-warning/60 text-warning text-xs font-bold rounded-xl hover:bg-warning/8 transition-colors">
                Suspend
              </button>
            )}
            {detail.status === 'suspended' && !driverMode && (
              <button onClick={() => void doDriverAction('reinstate')} disabled={driverLoading} className="px-3.5 py-1.5 bg-success text-white text-xs font-bold rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50">
                Reinstate
              </button>
            )}
          </div>
        </div>

        {/* Progress bar — shows approved/total uploaded */}
        <div className="h-0.5 bg-surface-2 flex-shrink-0">
          <div
            className="h-full bg-success transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* Sidebar */}
          <div className="w-[220px] flex-shrink-0 border-r border-border flex flex-col bg-surface">
            {/* Driver identity card */}
            <div className="px-4 py-4 border-b border-border/60">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-full bg-primary/12 flex items-center justify-center flex-shrink-0">
                  <span className="text-[11px] font-bold text-primary">
                    {(detail.full_name ?? detail.phone).split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-text-primary truncate">{detail.full_name ?? '—'}</p>
                  <p className="text-[10px] text-text-muted">{detail.phone}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {[{ l: 'Aadhaar', v: detail.aadhaar_number }, { l: 'Licence', v: detail.license_number }].map(({ l, v }) => (
                  <div key={l} className="flex items-baseline gap-2">
                    <span className="text-[10px] text-text-muted w-12 flex-shrink-0">{l}</span>
                    {v
                      ? <span className="font-mono text-[10px] text-text-secondary truncate">{v}</span>
                      : <span className="text-[10px] text-danger font-semibold">Missing</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Doc list */}
            <div className="flex-1 overflow-y-auto py-1">
              <p className="px-3 pt-3 pb-1.5 text-[9px] font-black text-text-muted uppercase tracking-widest">Identity</p>
              {allDocs.filter(d => d.kind === 'driver').map(d => (
                <SidebarDoc key={d.docType} doc={d} selected={allDocs.indexOf(d) === idx} idx={allDocs.indexOf(d)} total={allDocs.length} onClick={() => setIdx(allDocs.indexOf(d))} />
              ))}
              <p className="px-3 pt-3 pb-1.5 text-[9px] font-black text-text-muted uppercase tracking-widest">Vehicle</p>
              {allDocs.filter(d => d.kind === 'vehicle').map(d => (
                <SidebarDoc key={d.docType} doc={d} selected={allDocs.indexOf(d) === idx} idx={allDocs.indexOf(d)} total={allDocs.length} onClick={() => setIdx(allDocs.indexOf(d))} />
              ))}
            </div>

            {/* Stats footer */}
            <div className="px-4 py-3 border-t border-border/60 bg-surface-2/40">
              <div className="flex justify-between items-center text-[10px] mb-1.5">
                <span className="font-semibold text-text-muted">Review progress</span>
                <span className="font-bold text-text-primary">{approvedCount}/{totalUploaded}</span>
              </div>
              <div className="h-1 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-success rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-[10px]">
                {approvedCount > 0    && <span className="text-success font-semibold">{approvedCount} approved</span>}
                {allDocs.filter(d => d.status === 'rejected').length > 0 && (
                  <span className="text-danger font-semibold">{allDocs.filter(d => d.status === 'rejected').length} rejected</span>
                )}
                {allDocs.filter(d => !d.fileUrl || d.status === 'missing').length > 0 && (
                  <span className="text-text-muted">{allDocs.filter(d => !d.fileUrl || d.status === 'missing').length} missing</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: preview + action bar */}
          <div className="flex-1 min-w-0 flex flex-col">

            {/* ── Preview ─────────────────────────────────────────────────── */}
            <div className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden" style={{ background: '#0d0d0f' }}>

              {isMissing ? (
                <div className="flex flex-col items-center gap-3 select-none pointer-events-none">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
                    <FileText size={20} className="text-white/18" />
                  </div>
                  <p className="text-white/30 text-sm">Document not uploaded</p>
                </div>

              ) : isPdf ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center">
                    <FileText size={24} className="text-white/30" />
                  </div>
                  <p className="text-white/40 text-sm">PDF, can't preview inline</p>
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white/8 text-white/80 text-sm font-semibold rounded-xl hover:bg-white/14 transition-colors"
                  >
                    <ExternalLink size={14} /> Open PDF
                  </a>
                </div>

              ) : (
                <>
                  {/* Loading spinner — shows while image loading */}
                  <AnimatePresence>
                    {!imgLoaded && (
                      <motion.div
                        key="spinner"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-white/55 animate-spin" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Image — fades in once loaded */}
                  <div className={cn('w-full h-full flex items-center justify-center', !zoomFit && 'overflow-auto')}>
                    <img
                      key={doc.fileUrl}
                      src={doc.fileUrl}
                      alt={label(doc.docType)}
                      draggable={false}
                      onLoad={() => setImgLoaded(true)}
                      className={cn(
                        'select-none transition-opacity duration-300',
                        zoomFit ? 'max-w-full max-h-full object-contain' : 'w-auto h-auto',
                        imgLoaded ? 'opacity-100' : 'opacity-0'
                      )}
                      style={zoomFit ? { maxHeight: '100%' } : {}}
                    />
                  </div>
                </>
              )}

              {/* Zoom toggle */}
              {!isMissing && !isPdf && (
                <button
                  onClick={() => setZoomFit(z => !z)}
                  aria-label={zoomFit ? 'Zoom to actual size' : 'Fit to window'}
                  className="absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-black/70 transition-colors"
                >
                  {zoomFit ? <ZoomIn size={14} /> : <ZoomOut size={14} />}
                </button>
              )}

              {/* Prev / Next overlays */}
              {idx > 0 && (
                <button
                  onClick={() => setIdx(i => i - 1)}
                  aria-label="Previous document"
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-black/70 transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
              {idx < allDocs.length - 1 && (
                <button
                  onClick={() => setIdx(i => i + 1)}
                  aria-label="Next document"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-black/70 transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              )}
            </div>

            {/* ── Action bar ──────────────────────────────────────────────── */}
            <div className="flex-shrink-0 border-t border-border bg-surface px-5 py-4" style={{ minHeight: 80 }}>
              <AnimatePresence mode="wait" initial={false}>

                {/* Driver-level reject / suspend form */}
                {driverMode && (
                  <motion.div key="driver-form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }}>
                    <ReasonForm
                      title={
                        driverMode === 'rejectDocs' ? 'Reject Documents' :
                        driverMode === 'ban'        ? 'Ban Driver' :
                        'Suspend Driver'
                      }
                      placeholder="Provide a clear reason (minimum 10 characters)…"
                      confirmLabel={
                        driverMode === 'rejectDocs' ? 'Reject Docs' :
                        driverMode === 'ban'        ? 'Ban Driver' :
                        'Suspend Driver'
                      }
                      danger={driverMode === 'ban'}
                      loading={driverLoading}
                      onSubmit={reason => void doDriverAction(driverMode, reason)}
                      onCancel={() => setDriverMode(null)}
                    />
                  </motion.div>
                )}

                {/* Per-doc reject form */}
                {!driverMode && rejectDoc && (
                  <motion.div key="doc-reject-form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }}>
                    <ReasonForm
                      title={`Reject — ${label(doc.docType)}`}
                      placeholder="Explain what needs to be fixed and resubmitted…"
                      confirmLabel="Reject Document"
                      danger
                      loading={docLoading}
                      onSubmit={reason => void doDocReject(reason)}
                      onCancel={() => setRejectDoc(false)}
                    />
                  </motion.div>
                )}

                {/* Normal state */}
                {!driverMode && !rejectDoc && (
                  <motion.div key="normal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex items-center gap-3 h-full">

                    {/* Doc info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-text-primary">{label(doc.docType)}</span>
                        {doc.status === 'approved' && <span className="flex items-center gap-1 text-xs font-semibold text-success"><CheckCircle size={12} /> Approved</span>}
                        {doc.status === 'rejected' && <span className="flex items-center gap-1 text-xs font-semibold text-danger"><XCircle   size={12} /> Rejected</span>}
                        {doc.status === 'pending' && doc.fileUrl && <span className="flex items-center gap-1 text-xs font-semibold text-warning"><AlertCircle size={12} /> Pending</span>}
                        {isMissing && <span className="text-xs text-text-muted">Not uploaded</span>}
                      </div>
                      {doc.rejectionNote && doc.status === 'rejected' && (
                        <p className="text-xs text-danger mt-0.5 truncate">{doc.rejectionNote}</p>
                      )}
                      {doc.kind === 'driver' && (
                        <p className="text-xs text-text-muted mt-0.5 capitalize">{doc.docType.replace(/_/g, ' ')}</p>
                      )}
                    </div>

                    {/* Per-doc actions */}
                    {(canApprove || canReject) && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {canApprove && (
                          <button
                            onClick={() => void doDocApprove()}
                            disabled={docLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-success border border-success/35 rounded-xl bg-success/6 hover:bg-success/12 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle size={13} /> Approve
                          </button>
                        )}
                        {canReject && (
                          <button
                            onClick={() => setRejectDoc(true)}
                            disabled={docLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-danger border border-danger/35 rounded-xl bg-danger/6 hover:bg-danger/12 transition-colors disabled:opacity-50"
                          >
                            <XCircle size={13} /> Reject
                          </button>
                        )}
                      </div>
                    )}

                    {/* Navigation counter */}
                    <div className="flex items-center gap-1.5 flex-shrink-0 pl-3 border-l border-border">
                      <button
                        onClick={() => setIdx(i => i - 1)}
                        disabled={idx <= 0}
                        className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-surface-2 transition-colors disabled:opacity-25"
                      >
                        <ChevronLeft size={13} className="text-text-secondary" />
                      </button>
                      <span className="text-xs text-text-muted tabular-nums w-10 text-center">
                        {idx + 1} / {allDocs.length}
                      </span>
                      <button
                        onClick={() => setIdx(i => i + 1)}
                        disabled={idx >= allDocs.length - 1}
                        className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-surface-2 transition-colors disabled:opacity-25"
                      >
                        <ChevronRight size={13} className="text-text-secondary" />
                      </button>
                      <span className="text-[10px] text-text-muted ml-1 hidden md:block">← →</span>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
