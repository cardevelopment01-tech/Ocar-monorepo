'use client'
import { useEffect, useId, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import Toggle from '@/components/ui/Toggle'
import { RANGE_PRESETS, validateRange, type ReportFilters, type RangePreset } from '@/lib/reports-range'
import { cn } from '@/lib/utils'

export interface FilterOption { value: string; label: string }

interface Props {
  filters: ReportFilters
  cities: FilterOption[]
  categories: FilterOption[]
  onChange: (patch: Partial<ReportFilters>) => void
}

const chip = (selected: boolean) => cn(
  'min-h-[44px] px-4 rounded-full text-base font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
  selected ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
)

/** Sticky solid filter bar: range chips (+ native custom dates), city, category, comparison, export. */
export default function ReportFilterBar({ filters, cities, categories, onChange }: Props) {
  const id = useId()
  const [from, setFrom] = useState(filters.from)
  const [to, setTo] = useState(filters.to)
  const [showCustom, setShowCustom] = useState(filters.range === 'custom')
  const problem = showCustom ? validateRange(from, to) : null

  // Sync drafts from the URL only while the custom editor is closed: otherwise a URL update landing
  // mid-edit would overwrite what the user is typing.
  useEffect(() => { if (!showCustom) { setFrom(filters.from); setTo(filters.to) } }, [filters.from, filters.to, showCustom])
  useEffect(() => { if (filters.range !== 'custom') setShowCustom(false) }, [filters.range])

  function pick(range: RangePreset) {
    setShowCustom(false)
    onChange({ range })
  }
  function applyCustom(nextFrom: string, nextTo: string) {
    setFrom(nextFrom); setTo(nextTo)
    if (!validateRange(nextFrom, nextTo)) onChange({ range: 'custom', from: nextFrom, to: nextTo })
  }

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-3 bg-canvas">
      <div className="admin-card !p-3 !cursor-default flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="group" aria-label="Date range" className="flex flex-wrap items-center gap-2">
          {RANGE_PRESETS.map(p => (
            <button key={p.key} type="button" aria-pressed={filters.range === p.key && !showCustom} onClick={() => pick(p.key)} className={chip(filters.range === p.key && !showCustom)}>
              {p.label}
            </button>
          ))}
          <button type="button" aria-pressed={showCustom} onClick={() => { setFrom(filters.from); setTo(filters.to); setShowCustom(true) }} className={chip(showCustom)}>Custom</button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectFilter label="City" options={cities} selected={filters.cityIds} searchable searchPlaceholder="Search cities…" onChange={v => onChange({ cityIds: v })} />
          <label className="sr-only" htmlFor={`${id}-cat`}>Vehicle category</label>
          <select
            id={`${id}-cat`}
            value={filters.categoryId ?? ''}
            onChange={e => onChange({ categoryId: e.target.value || null })}
            className="min-h-[44px] px-3 text-base rounded-xl border border-border bg-surface text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {showCustom && (
          <div className="basis-full flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`${id}-from`} className="block text-base font-medium text-text-secondary mb-1">From</label>
              <input id={`${id}-from`} type="date" value={from} max={to || undefined} onChange={e => applyCustom(e.target.value, to)}
                className="min-h-[44px] px-3 text-md rounded-xl border border-border bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className="block text-base font-medium text-text-secondary mb-1">To</label>
              <input id={`${id}-to`} type="date" value={to} min={from || undefined} onChange={e => applyCustom(from, e.target.value)}
                className="min-h-[44px] px-3 text-md rounded-xl border border-border bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
            </div>
            {problem && <p role="alert" className="text-base text-danger pb-3">{problem}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Comparison switch and (finance class only) CSV export; sits beside the tabs, not in the sticky bar. */
export function ReportActions({ compare, onCompare, onExport, exporting }: {
  compare: ReportFilters['compare']; onCompare: (c: ReportFilters['compare']) => void
  /** finance class only; undefined hides the button */
  onExport?: () => void; exporting?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-3">
      <span id={`${id}-cmp`} className="text-base text-text-secondary">Compare to previous period</span>
      <Toggle checked={compare === 'prev'} onChange={v => onCompare(v ? 'prev' : 'off')} labelledBy={`${id}-cmp`} />
      {onExport && (
        <button type="button" onClick={onExport} disabled={exporting} className="btn-secondary min-h-[44px] disabled:opacity-50">
          {exporting ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Download size={14} aria-hidden />}
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      )}
    </div>
  )
}
