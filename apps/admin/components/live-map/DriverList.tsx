'use client'

import { Search } from 'lucide-react'
import type { ActiveDriverSession } from '@/lib/admin-api'
import { STAGES, STAGE_META, type Stage, type StageFilter } from '@/lib/live-map-model'
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
}

// The list beside the map: find a driver by name, phone, plate or ride number, filter by where they are, and see who needs attention first.
// The filter chips double as the map legend (the dot colour is the marker colour).
export function DriverList({ rows, total, counts, query, onQuery, filter, onFilter, selectedId, onSelect, nowMs }: Props) {
  return (
    <aside className="hidden md:flex w-80 flex-shrink-0 flex-col border-r border-border bg-surface" aria-label="Drivers">
      <div className="p-3 border-b border-border space-y-2">
        <label className="relative block">
          <span className="sr-only">Search drivers</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Name, phone, plate, ride no."
            className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-8 pr-3 text-sm text-text-primary outline-none focus:border-primary"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          <Chip active={filter === 'all'} onClick={() => onFilter('all')} label={`All ${total}`} />
          {STAGES.map((s) => (
            <Chip key={s} active={filter === s} onClick={() => onFilter(filter === s ? 'all' : s)} label={`${STAGE_META[s].label} ${counts[s]}`} color={STAGE_META[s].color} />
          ))}
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <li className="p-4 text-sm text-text-muted">{total === 0 ? 'No drivers are online.' : 'No driver matches.'}</li>
        )}
        {rows.map(({ d, stage }) => {
          const meta = STAGE_META[stage]
          return (
            <li key={d.driver_id}>
              <button
                type="button"
                onClick={() => onSelect(d.driver_id)}
                aria-current={selectedId === d.driver_id}
                className={cn('flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left hover:bg-surface-2', selectedId === d.driver_id && 'bg-surface-2')}
              >
                <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
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
        })}
      </ul>
    </aside>
  )
}

function Chip({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', active ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-text-secondary hover:bg-surface-2')}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />}
      {label}
    </button>
  )
}
