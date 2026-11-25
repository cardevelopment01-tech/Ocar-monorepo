'use client'

import { Clock, Filter, Flag, PanelLeftOpen, ShieldAlert, WifiOff, X } from 'lucide-react'
import type { AttentionCounts, AttentionKind } from '@/lib/live-map-attention'
import { cn } from '@/lib/utils'

const GLASS = 'rounded-2xl border border-white/70 bg-white/90 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/5 backdrop-blur-md'

// Top-left of the map: the headline numbers, and the button that brings the driver panel back when it is hidden. A silent on-trip driver and a
// lost connection are the two things that make the numbers unreliable, so they sit right beside them in red.
export function StatusBar({ online, onTrip, silent, socketLive, panelOpen, onOpenPanel, filtered, onClearFilters }: { online: number; onTrip: number; silent: number; socketLive: boolean; panelOpen: boolean; onOpenPanel: () => void; filtered: boolean; onClearFilters: () => void }) {
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
      {!panelOpen && (
        <button type="button" onClick={onOpenPanel} aria-label="Show the driver panel" className={cn(GLASS, 'pointer-events-auto p-2.5 text-text-secondary hover:text-primary')}>
          <PanelLeftOpen size={16} aria-hidden />
        </button>
      )}
      <div className={cn(GLASS, 'pointer-events-auto flex items-center gap-4 px-4 py-2')}>
        <Stat color="bg-success" label="Online" value={online} />
        <span className="h-5 w-px bg-border" aria-hidden />
        <Stat color="bg-primary" label="On trip" value={onTrip} />
        {silent > 0 && (
          <>
            <span className="h-5 w-px bg-border" aria-hidden />
            <Stat color="bg-danger" label="No location" value={silent} tone="text-danger" />
          </>
        )}
      </div>
      {filtered && (
        <button type="button" onClick={onClearFilters} aria-label="Clear the city and vehicle filters" className={cn(GLASS, 'pointer-events-auto flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-light')}>
          <Filter size={13} aria-hidden /> Filtered <X size={12} aria-hidden />
        </button>
      )}
      {!socketLive && (
        <div className={cn(GLASS, 'pointer-events-auto flex items-center gap-2 px-3 py-2 text-xs font-semibold text-danger')} role="status">
          <WifiOff size={14} aria-hidden /> Reconnecting, positions may be stale
        </div>
      )}
    </div>
  )
}

function Stat({ color, label, value, tone }: { color: string; label: string; value: number; tone?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn('h-2 w-2 rounded-full', color)} aria-hidden />
      <span className={cn('font-display text-base font-bold tabular-nums', tone ?? 'text-text-primary')}>{value}</span>
      <span className={cn('text-xs font-medium', tone ?? 'text-text-muted')}>{label}</span>
    </span>
  )
}

const LAYERS: { kind: AttentionKind; label: string; count: keyof AttentionCounts; Icon: typeof Flag; on: string }[] = [
  { kind: 'sos', label: 'SOS', count: 'sos', Icon: ShieldAlert, on: 'bg-danger text-white' },
  { kind: 'flagged', label: 'Flagged rides', count: 'flagged', Icon: Flag, on: 'bg-warning text-white' },
  { kind: 'request', label: 'Unmet requests', count: 'requests', Icon: Clock, on: 'bg-purple text-white' },
]

// Top-right of the map: switch the SOS, flagged-ride and unmet-request layers on and off. The icons match the markers. A hidden SOS layer with
// an open alert keeps a red ring so it cannot be switched off and forgotten.
export function LayerControl({ layers, totals, onToggle }: { layers: Record<AttentionKind, boolean>; totals: AttentionCounts; onToggle: (k: AttentionKind) => void }) {
  return (
    <div className={cn(GLASS, 'absolute right-4 top-4 z-10 flex flex-col gap-1 p-1.5')} role="group" aria-label="Map layers">
      {LAYERS.map(({ kind, label, count, Icon, on }) => {
        const active = layers[kind]
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            aria-label={`${label} ${totals[count]}`}
            title={`${label}: ${active ? 'shown' : 'hidden'}`}
            onClick={() => onToggle(kind)}
            className={cn(
              'flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-semibold transition-colors',
              active ? on : 'text-text-secondary hover:bg-surface-2',
              kind === 'sos' && totals.sos > 0 && !active && 'ring-2 ring-danger',
            )}
          >
            <Icon size={14} aria-hidden />
            <span className="w-24 truncate">{label}</span>
            <span className={cn('min-w-5 rounded-full px-1.5 text-center tabular-nums', active ? 'bg-white/25' : 'bg-surface-3')}>{totals[count]}</span>
          </button>
        )
      })}
    </div>
  )
}
