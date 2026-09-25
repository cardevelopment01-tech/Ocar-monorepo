'use client'

import { cn } from '@/lib/utils'

export interface RailItem { id: string; title: string; count: number; dirty: number }

interface Props {
  items: RailItem[]
  activeId: string | null
  onSelect: (id: string) => void
}

function Dot({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <>
      <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
      <span className="sr-only">{n} unsaved</span>
    </>
  )
}

/** Desktop: a sticky index rail. Below lg: a horizontally scrollable chip row. Same data, one visible at a time. */
export default function SectionRail({ items, activeId, onSelect }: Props) {
  return (
    <>
      <nav aria-label="Setting groups" className="sticky top-24 hidden self-start lg:block">
        <ul className="space-y-0.5">
          {items.map(i => {
            const active = i.id === activeId
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => onSelect(i.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-left text-base transition-colors duration-150 motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    active ? 'bg-primary-light font-semibold text-primary-dark' : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary',
                  )}
                >
                  <span className="flex-1 truncate">{i.title}</span>
                  <Dot n={i.dirty} />
                  <span className="text-sm tabular-nums text-text-muted">{i.count}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <nav aria-label="Setting groups" className="-mx-6 overflow-x-auto px-6 pb-1 lg:hidden [scrollbar-width:none]">
        <ul className="flex gap-2">
          {items.map(i => {
            const active = i.id === activeId
            return (
              <li key={i.id} className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(i.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-full border px-4 text-base font-medium transition-colors duration-150 motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    active ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-text-secondary hover:bg-surface-3',
                  )}
                >
                  {i.title}
                  <Dot n={i.dirty} />
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
