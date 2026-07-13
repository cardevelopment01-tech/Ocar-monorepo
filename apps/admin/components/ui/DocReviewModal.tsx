'use client'
import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, AlertCircle,
  FileText, ZoomIn, ZoomOut, ExternalLink, Minimize2, RotateCw,
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
  profile_photo:         'Profile Photo',
  driving_license:       'Driving Licence',
  driving_license_front: 'Driving Licence (Front)',
  driving_license_back:  'Driving Licence (Back)',
  aadhaar_front:         'Aadhaar (Front)',
  aadhaar_back:          'Aadhaar (Back)',
  vehicle_rc:            'RC Book',
  insurance:             'Insurance',
  permit:                'Commercial Permit',
  pollution_cert:        'Pollution Certificate (PUC)',
  fitness_cert:          'Fitness Certificate',
}
const label = (k: string) => DOC_LABELS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const REQUIRED_DRIVER  = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
const REQUIRED_VEHICLE = ['vehicle_rc', 'insurance', 'permit']

function nextActionableIdx(docs: FlatDoc[], from: number): number | null {
  for (let i = from + 1; i < docs.length; i++) {
    const d = docs[i]
    if (d && d.status === 'pending' && d.fileUrl) return i
  }
  return null
}

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
        'group w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-100',
        selected ? 'bg-primary/10' : 'hover:bg-black/4'
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
        <p className={cn('text-[11px] mt-0.5 capitalize leading-none',
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
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && valid && !loading) {
            e.preventDefault()
            onSubmit(value.trim())
          }
        }}
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
  const [zoomLevel, setZoomLevel]         = useState<number | 'fit'>('fit')
  const [rotation, setRotation]           = useState(0) // 0 | 90 | 180 | 270
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [imgLoaded, setImgLoaded]         = useState(false)
  const [docLoading, setDocLoading]       = useState(false)
  const [driverLoading, setDriverLoading] = useState(false)
  const [rejectDoc, setRejectDoc]         = useState(false)
  const [driverMode, setDriverMode]       = useState<'rejectDocs' | 'ban' | 'suspend' | null>(null)
  const [mounted, setMounted]             = useState(false)
  const scrollRef                         = useRef<HTMLDivElement>(null)
  const isDragging                        = useRef(false)
  const dragStart                         = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })

  const ZOOM_MIN  = 1
  const ZOOM_MAX  = 4
  const ZOOM_STEP = 0.2

  function zoomIn() {
    setZoomLevel(z => Math.min(ZOOM_MAX, (z === 'fit' ? ZOOM_MIN : z) + ZOOM_STEP))
  }
  function zoomOut() {
    setZoomLevel(z => {
      if (z === 'fit') return z
      const next = z - ZOOM_STEP
      return next <= ZOOM_MIN ? 'fit' : next
    })
  }

  // Trackpad pinch/scroll fires many small wheel ticks — scale the zoom change to each
  // tick's actual size (deltaY ~100 = one real notch) instead of a fixed step per event,
  // so a small pinch produces a small zoom change instead of overshooting.
  function zoomByDelta(deltaY: number) {
    const amount = Math.min(ZOOM_STEP, (Math.abs(deltaY) / 100) * ZOOM_STEP)
    if (amount === 0) return
    setZoomLevel(z => {
      const cur = z === 'fit' ? ZOOM_MIN : z
      const next = deltaY < 0 ? cur + amount : cur - amount
      if (next <= ZOOM_MIN) return 'fit'
      return Math.min(ZOOM_MAX, next)
    })
  }

  // Zoom in centered on the clicked point (or back to fit if already zoomed).
  function zoomToPoint(clientX: number, clientY: number) {
    const el = scrollRef.current
    if (!el) return
    if (zoomLevel !== 'fit') { setZoomLevel('fit'); return }
    const rect = el.getBoundingClientRect()
    const clickX = clientX - rect.left
    const clickY = clientY - rect.top
    const target = 2.5
    setZoomLevel(target)
    requestAnimationFrame(() => {
      el.scrollLeft = clickX * target - rect.width / 2
      el.scrollTop  = clickY * target - rect.height / 2
    })
  }

  // Non-passive wheel listener, required so we can preventDefault and prevent page scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      zoomByDelta(e.deltaY)
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    setRejectDoc(false)
    setZoomLevel('fit')
    setRotation(0)
    setImgLoaded(false)
    scrollRef.current?.scrollTo(0, 0)
  }, [idx])

  // Track preview container size so a rotated image can be scaled to still fit
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [idx])

  // After each zoom change, center the scroll so the image stays in view
  useEffect(() => {
    if (zoomLevel === 'fit' || !scrollRef.current) return
    const el = scrollRef.current
    requestAnimationFrame(() => {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
      el.scrollTop  = (el.scrollHeight - el.clientHeight) / 2
    })
  }, [zoomLevel])

  // Drag-to-pan via Pointer Events, active only when zoomed
  useEffect(() => {
    const rawEl = scrollRef.current
    if (!rawEl || zoomLevel === 'fit') return
    const el = rawEl

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      isDragging.current = true
      dragStart.current  = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    function onPointerMove(e: PointerEvent) {
      if (!isDragging.current) return
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      el.scrollLeft = dragStart.current.scrollLeft - dx
      el.scrollTop  = dragStart.current.scrollTop  - dy
      e.preventDefault()
    }
    function endDrag(e: PointerEvent) {
      if (!isDragging.current) return
      isDragging.current = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      el.style.cursor = 'grab'
    }

    el.addEventListener('pointerdown',   onPointerDown)
    el.addEventListener('pointermove',   onPointerMove)
    el.addEventListener('pointerup',     endDrag)
    el.addEventListener('pointercancel', endDrag)
    return () => {
      el.removeEventListener('pointerdown',   onPointerDown)
      el.removeEventListener('pointermove',   onPointerMove)
      el.removeEventListener('pointerup',     endDrag)
      el.removeEventListener('pointercancel', endDrag)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel, idx])

  const isZoomed   = zoomLevel !== 'fit'
  const doc        = allDocs[idx]
  const isMissing  = !doc?.fileUrl || doc.status === 'missing'
  const isPdf      = doc?.fileUrl && /\.pdf(\?|$)/i.test(doc.fileUrl)
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
      const next = nextActionableIdx(allDocs, idx)
      if (next !== null) setIdx(next)
    } finally { setDocLoading(false) }
  }
  async function doDocReject(reason: string) {
    if (!doc?.id) return
    setDocLoading(true)
    try {
      if (doc.kind === 'driver') await onDriverDocReject(doc.id, reason)
      else                       await onVehicleDocReject(doc.id, reason)
      setRejectDoc(false)
      const next = nextActionableIdx(allDocs, idx)
      if (next !== null) setIdx(next)
    } finally { setDocLoading(false) }
  }
  async function doDriverAction(type: 'approve' | 'rejectDocs' | 'ban' | 'suspend' | 'reinstate', reason?: string) {
    setDriverLoading(true)
    try { await onDriverAction(type, reason); onClose() } finally { setDriverLoading(false) }
  }

  // Keyboard nav + action shortcuts (A = approve, R = reject, ←/→ = navigate)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') {
        if (rejectDoc || driverMode) { setRejectDoc(false); setDriverMode(null) }
        else onClose()
      }
      if (e.key === 'ArrowLeft'  && idx > 0)                  setIdx(i => i - 1)
      if (e.key === 'ArrowRight' && idx < allDocs.length - 1) setIdx(i => i + 1)
      const k = e.key.toLowerCase()
      if (!rejectDoc && !driverMode) {
        if (k === 'a' && canApprove) { e.preventDefault(); void doDocApprove() }
        if (k === 'r' && canReject)  { e.preventDefault(); setRejectDoc(true) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // doDocApprove closes over doc/idx/allDocs, re-bind on idx change (already in deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, allDocs.length, onClose, rejectDoc, driverMode, canApprove, canReject])

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
            {detail.status === 'docs_rejected' && !driverMode && (
              <>
                <button
                  onClick={() => void doDriverAction('approve')}
                  disabled={driverLoading}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-success text-white text-xs font-bold rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  <CheckCircle size={13} /> Approve
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

        {/* Progress bar: shows approved/total uploaded */}
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
                  <p className="text-[11px] text-text-muted">{detail.phone}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {[{ l: 'Aadhaar', v: detail.aadhaar_number }, { l: 'Licence', v: detail.license_number }].map(({ l, v }) => (
                  <div key={l} className="flex items-baseline gap-2">
                    <span className="text-[11px] text-text-muted w-12 flex-shrink-0">{l}</span>
                    {v
                      ? <span className="font-mono text-[11px] text-text-secondary truncate">{v}</span>
                      : <span className="text-[11px] text-danger font-semibold">Missing</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Doc list */}
            <div className="flex-1 overflow-y-auto py-1">
              <p className="px-3 pt-3 pb-1.5 text-[11px] font-medium text-text-muted">Identity</p>
              {allDocs.filter(d => d.kind === 'driver').map(d => (
                <SidebarDoc key={d.docType} doc={d} selected={allDocs.indexOf(d) === idx} idx={allDocs.indexOf(d)} total={allDocs.length} onClick={() => setIdx(allDocs.indexOf(d))} />
              ))}
              <div className="mx-3 mt-2 border-t border-border/60" />
              <p className="px-3 pt-2.5 pb-1.5 text-[11px] font-medium text-text-muted">Vehicle</p>
              {allDocs.filter(d => d.kind === 'vehicle').map(d => (
                <SidebarDoc key={d.docType} doc={d} selected={allDocs.indexOf(d) === idx} idx={allDocs.indexOf(d)} total={allDocs.length} onClick={() => setIdx(allDocs.indexOf(d))} />
              ))}
            </div>

            {/* Stats footer */}
            <div className="px-4 py-3 border-t border-border/60 bg-surface-2/40">
              <div className="flex justify-between items-center text-[11px] mb-1.5">
                <span className="font-semibold text-text-muted">Review progress</span>
                <span className="font-bold text-text-primary">{approvedCount}/{totalUploaded}</span>
              </div>
              <div className="h-1 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-success rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-[11px]">
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
                <div className="w-full h-full flex flex-col bg-[#0d0d0f]">
                  <iframe
                    src={doc.fileUrl}
                    title={label(doc.docType)}
                    className="flex-1 w-full border-0 bg-white"
                  />
                  <div className="flex-shrink-0 flex items-center justify-center gap-2 py-2 text-white/40 text-xs">
                    Can&apos;t display the PDF?
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-white/70 hover:text-white underline transition-colors"
                    >
                      <ExternalLink size={12} /> Open in new tab
                    </a>
                  </div>
                </div>

              ) : (
                <>
                  {/* Loading spinner: shows while image loading */}
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

                  {/* Image: fit mode centres in container, zoom mode grows wrapper so overflow scrolls */}
                  <div
                    ref={scrollRef}
                    onDoubleClick={e => zoomToPoint(e.clientX, e.clientY)}
                    className={cn('w-full h-full overflow-auto', isZoomed && 'cursor-grab')}
                    style={isZoomed ? { touchAction: 'none' } : undefined}
                  >
                    <div
                      className="flex items-center justify-center p-4"
                      style={{
                        minWidth: '100%',
                        minHeight: '100%',
                        width:  zoomLevel === 'fit' ? '100%' : `${(zoomLevel as number) * 100}%`,
                        height: zoomLevel === 'fit' ? '100%' : `${(zoomLevel as number) * 100}%`,
                      }}
                    >
                      <img
                        key={doc.fileUrl}
                        src={doc.fileUrl}
                        alt={label(doc.docType)}
                        draggable={false}
                        onLoad={() => setImgLoaded(true)}
                        className={cn(
                          'select-none object-contain transition-opacity duration-300',
                          !isZoomed && rotation % 180 === 0 && 'max-w-full max-h-full',
                          imgLoaded ? 'opacity-100' : 'opacity-0'
                        )}
                        style={{
                          transform: `rotate(${rotation}deg)`,
                          transition: 'transform 0.25s ease, opacity 0.3s',
                          // Zoomed: force the image to actually fill the enlarged wrapper so object-contain
                          // upscales it — otherwise it's capped at its natural pixel size and never grows.
                          ...(isZoomed
                            ? { width: '100%', height: '100%' }
                            : rotation % 180 !== 0 && containerSize.w && containerSize.h
                              ? { maxWidth: containerSize.h, maxHeight: containerSize.w }
                              : {}),
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Zoom controls */}
              {!isMissing && !isPdf && (
                <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-lg px-1.5 py-1">
                  <button
                    onClick={zoomOut}
                    disabled={zoomLevel === 'fit'}
                    aria-label="Zoom out"
                    className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span className="text-[11px] text-white/60 tabular-nums w-9 text-center select-none">
                    {zoomLevel === 'fit' ? 'Fit' : `${Math.round((zoomLevel as number) * 100)}%`}
                  </span>
                  <button
                    onClick={zoomIn}
                    disabled={zoomLevel !== 'fit' && zoomLevel >= ZOOM_MAX}
                    aria-label="Zoom in"
                    className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    <ZoomIn size={13} />
                  </button>
                  <button
                    onClick={() => setZoomLevel('fit')}
                    disabled={!isZoomed}
                    aria-label="Reset to fit"
                    className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    <Minimize2 size={12} />
                  </button>
                  <button
                    onClick={() => setRotation(r => (r + 90) % 360)}
                    aria-label="Rotate document 90 degrees"
                    className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white transition-colors ml-0.5 border-l border-white/15 pl-1"
                  >
                    <RotateCw size={13} />
                  </button>
                </div>
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
                      title={`Reject: ${label(doc.docType)}`}
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
