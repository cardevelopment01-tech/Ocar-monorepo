'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import type { AttentionItem } from '@/lib/live-map-attention'
import { ago } from '@/lib/ride-situation'

const KIND_LABEL = { sos: 'SOS alert', flagged: 'Flagged ride', request: 'Unmet request' } as const

// The card for a selected SOS, flagged ride or unmet request: what it is, how long, and one button to the page where it is handled.
export function AttentionPanel({ item, nowMs, onClose, onAssign }: { item: AttentionItem; nowMs: number; onClose: () => void; onAssign?: (rideId: string) => void }) {
  return (
    <div className="absolute bottom-4 left-4 z-[1000] w-80 overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-xl shadow-slate-900/15 ring-1 ring-slate-900/5 backdrop-blur-md" role="dialog" aria-label={item.title}>
      <div className="flex items-start justify-between gap-3 p-4 pb-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{KIND_LABEL[item.kind]}</p>
          <p className="font-display text-base font-bold text-text-primary">{item.title}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={16} aria-hidden /></button>
      </div>
      <div className="px-4 pb-3">
        <p className="text-xs text-text-secondary">{item.detail}</p>
        <p className={`mt-1 text-xs ${item.urgent ? 'font-semibold text-danger' : 'text-text-muted'}`}>{ago(item.since, nowMs) || 'just now'}{item.urgent ? ' · nobody has acknowledged it' : ''}</p>
      </div>
      <div className="flex gap-2 border-t border-border-light p-3">
        {item.assignable && item.rideId && onAssign && (
          <button type="button" onClick={() => onAssign(item.rideId!)} className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark">Assign a driver</button>
        )}
        <Link href={item.href} className="flex flex-1 items-center justify-center rounded-xl border border-border px-3 py-2 text-xs font-semibold text-primary hover:bg-surface-2">{item.linkLabel}</Link>
      </div>
    </div>
  )
}
