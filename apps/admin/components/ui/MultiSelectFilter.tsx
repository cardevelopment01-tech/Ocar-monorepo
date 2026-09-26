'use client'
import { useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MultiSelectOption {
  value: string
  label: string
  count?: number
}

interface Props {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (next: string[]) => void
  searchPlaceholder?: string
  /** show the in-popover search box (worth it for long lists like cities) */
  searchable?: boolean
}

export default function MultiSelectFilter({ label, options, selected, onChange, searchPlaceholder = 'Search…', searchable = false }: Props) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const shown = query ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())) : options

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }

  // Arrow keys move between options; Space/Enter toggle via the option button's own click.
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="checkbox"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0)
    items[next]?.focus()
    e.preventDefault()
  }

  const active = selected.length > 0

  return (
    <Popover.Root onOpenChange={open => { if (!open) setQuery('') }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={active ? `${label}, ${selected.length} selected` : label}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm rounded-xl border transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
            active ? 'border-primary bg-primary-light text-primary font-medium' : 'border-border bg-surface text-text-secondary hover:bg-surface-2',
          )}
        >
          {label}
          {active && <span className="bg-primary text-white rounded-full text-[11px] font-semibold px-1.5 leading-4">{selected.length}</span>}
          <ChevronDown size={14} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 max-sm:w-[calc(100vw-2rem)] bg-surface border border-border rounded-xl shadow-lg p-2"
        >
          {searchable && (
            <div className="relative mb-2">
              <Search size={13} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full pl-8 pr-2 py-1.5 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary"
              />
            </div>
          )}
          <div ref={listRef} role="group" aria-label={label} onKeyDown={onListKeyDown} className="max-h-64 overflow-y-auto">
            {shown.length === 0 && <p className="px-2 py-3 text-sm text-text-muted">No matches</p>}
            {shown.map(o => {
              const checked = selected.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(o.value)}
                  className={cn(
                    'w-full flex items-center justify-between gap-3 px-2 rounded-lg text-sm text-left min-h-[44px] sm:min-h-9 hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/30',
                    o.count === 0 && !checked && 'opacity-50',
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={cn('flex-none w-4 h-4 rounded border flex items-center justify-center', checked ? 'bg-primary border-primary text-white' : 'border-border')}>
                      {checked && <Check size={11} aria-hidden />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </span>
                  {o.count !== undefined && <span className="text-xs text-text-muted tabular-nums">{o.count}</span>}
                </button>
              )
            })}
          </div>
          {active && (
            <div className="mt-2 pt-2 border-t border-border-light">
              <button type="button" onClick={() => onChange([])} className="text-xs font-medium text-text-secondary hover:text-text-primary px-2 py-1">
                Clear
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
