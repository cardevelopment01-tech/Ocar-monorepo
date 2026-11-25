'use client'

import { memo } from 'react'
import { PanelLeftClose, Search, X } from 'lucide-react'
import type { ActiveDriverSession } from '@/lib/admin-api'
import { STAGES, STAGE_META, type Facet, type FleetFilter, type Stage, type StageFilter } from '@/lib/live-map-model'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import { ago } from '@/lib/ride-situation'
import { cn } from '@/lib/utils'

interface Row { d: ActiveDriverSession; stage: Stage }

interface Props {
  rows: Row[]
  total: number
  counts: Record<Stage, number>
  query: string
  onQuery: (q: string) => void
  filter: StageFilter
  onFilter: (f: StageFilter) => void
  selectedId: string | null
  onSelect: (driverId: string) => void
  nowMs: number
  /** Live connection state shown beside the title; leave out to hide it. */
  live?: boolean
  /** City and vehicle filters; leave out to hide them. */
  fleet?: FleetFilter
  onFleet?: (f: FleetFilter) => void
  facets?: { cities: Facet[]; categories: Facet[] }
  onCollapse?: () => void
}

// The panel beside the map: who is out there (online, on a trip), find a driver by name, phone, plate or ride number, narrow by city, vehicle
// and where they are, and see who needs attention first. The status tiles double as the map legend (the dot colour is the marker colour).
export function DriverList({ rows, total, counts, query, onQuery, filter, onFilter, selectedId, onSelect, nowMs, live, fleet, onFleet, facets, onCollapse }: Props) {
  const fleetActive = !!fleet && (fleet.cities.length > 0 || fleet.categories.length > 0)
  return (
    <aside className="hidden md:flex w-80 flex-shrink-0 flex-col border-r border-border bg-surface" aria-label="Drivers">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-bold text-text-primary">Live fleet</h2>
          {live !== undefined && (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', live ? 'bg-success-light text-success' : 'bg-danger-light text-danger')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-success' : 'bg-danger')} aria-hidden />
              {live ? 'Live' : 'Reconnecting'}
            </span>
          )}
          <div className="flex-1" />
          {onCollapse && (
            <button type="button" onClick={onCollapse} aria-label="Hide the driver panel" className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary">
              <PanelLeftClose size={16} aria-hidden />
            </button>
          )}
        </div>

        <label className="relative block">
          <span className="sr-only">Search drivers</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Name, phone, plate, ride no."
            className="w-full rounded-xl border border-border bg-surface-2 py-2 pl-8 pr-3 text-sm text-text-primary outline-none transition-colors focus:border-primary focus:bg-surface"
          />
        </label>

        {fleet && onFleet && facets && (facets.cities.length > 0 || facets.categories.length > 0 || fleetActive) && (
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectFilter label="City" options={facets.cities} selected={fleet.cities} onChange={(cities) => onFleet({ ...fleet, cities })} />
            <MultiSelectFilter label="Vehicle" options={facets.categories} selected={fleet.categories} onChange={(categories) => onFleet({ ...fleet, categories })} />
            {fleetActive && (
              <button type="button" onClick={() => onFleet({ cities: [], categories: [] })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-2 hover:text-text-primary">
                <X size={12} aria-hidden /> Clear
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Filter by status">
          <Tile active={filter === 'all'} onClick={() => onFilter('all')} name="All" count={total} />
          {STAGES.map((s) => (
            <Tile key={s} active={filter === s} onClick={() => onFilter(filter === s ? 'all' : s)} name={STAGE_META[s].label} count={counts[s]} color={STAGE_META[s].color} />
          ))}
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <li className="p-6 text-center text-sm text-text-muted">{total === 0 ? (fleetActive ? 'No driver matches these filters.' : 'No drivers are online.') : 'No driver matches.'}</li>
        )}
        {rows.map(({ d, stage }) => (
          <Row key={d.driver_id} d={d} stage={stage} selected={selectedId === d.driver_id} nowMs={stage === 'no_location' ? nowMs : 0} onSelect={onSelect} />
        ))}
      </ul>
    </aside>
  )
}

// One row. Memoized: a flush re-renders the list, and only the rows whose driver changed (or whose "last seen" clock ticked) should redraw.
// `nowMs` is passed only to rows that show it, so the clock tick leaves the others alone. `content-visibility: auto` makes the browser skip
// layout and paint for rows scrolled out of view.
const Row = memo(function Row({ d, stage, selected, nowMs, onSelect }: { d: ActiveDriverSession; stage: Stage; selected: boolean; nowMs: number; onSelect: (driverId: string) => void }) {
  const meta = STAGE_META[stage]
  return (
    <li style={{ contentVisibility: 'auto', containIntrinsicSize: '0 61px' }}>
      <button
        type="button"
        onClick={() => onSelect(d.driver_id)}
        aria-current={selected}
        className={cn('flex w-full items-center gap-3 border-b border-border-light px-4 py-2.5 text-left transition-colors hover:bg-surface-2', selected && 'bg-primary-light')}
      >
        <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: meta.color }} aria-hidden>
          {initials(d.driver_name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text-primary">{d.driver_name ?? 'Driver'}</span>
          <span className="block truncate text-xs text-text-muted">
            {meta.label}
            {stage === 'no_location' ? ` · last seen ${ago(d.location_updated_at, nowMs) || 'a long time ago'}` : ''}
            {d.ride_id ? ` · ride ${d.ride_id}` : ''}
            {d.number_plate ? ` · ${d.number_plate}` : ''}
          </span>
        </span>
      </button>
    </li>
  )
})

export function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase()
}

// The tile is narrow, so the longest label is shortened there (the button's accessible name keeps the full one).
const SHORT: Record<string, string> = { 'Waiting at pickup': 'At pickup', 'No location': 'No signal' }

// A status tile: the colour dot is the marker colour on the map, the number is how many. Pressing the active one clears it.
function Tile({ name, count, active, onClick, color }: { name: string; count: number; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${name} ${count}`}
      className={cn('flex flex-col items-start rounded-xl border px-2 py-1.5 text-left transition-colors', active ? 'border-primary bg-primary-light' : 'border-border bg-surface hover:bg-surface-2')}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        {color && <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
        <span className="min-w-0 truncate text-[11px] font-medium text-text-muted">{SHORT[name] ?? name}</span>
      </span>
      <span className="font-display text-base font-bold tabular-nums leading-5 text-text-primary">{count}</span>
    </button>
  )
}
