'use client'

import Link from 'next/link'
import type { AttentionItem } from '@/lib/live-map-attention'
import { ago } from '@/lib/ride-situation'

const KIND_LABEL = { sos: 'SOS alert', flagged: 'Flagged ride', request: 'Unmet request' } as const

// The card for a selected SOS, flagged ride or unmet request: what it is, how long, and one button to the page where it is handled.
export function AttentionPanel({ item, nowMs, onClose, onAssign }: { item: AttentionItem; nowMs: number; onClose: () => void; onAssign?: (rideId: string) => void }) {
  return (
    <div className="absolute bottom-4 left-4 md:left-[21rem] z-[1000] w-72 bg-surface rounded-2xl border border-border p-4 shadow-card" role="dialog" aria-label={item.title}>
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{KIND_LABEL[item.kind]}</p>
          <p className="font-bold text-text-primary text-sm">{item.title}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
      </div>
      <p className="text-xs text-text-secondary">{item.detail}</p>
      <p className="mt-1 text-xs text-text-muted">{ago(item.since, nowMs) || 'just now'}{item.urgent ? ' · nobody has acknowledged it' : ''}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.assignable && item.rideId && onAssign && (
          <button type="button" onClick={() => onAssign(item.rideId!)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Assign a driver</button>
        )}
        <Link href={item.href} className="inline-block rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-2">{item.linkLabel}</Link>
      </div>
    </div>
  )
}
