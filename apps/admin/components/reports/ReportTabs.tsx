'use client'
import { useRef } from 'react'
import { motion } from 'framer-motion'
import { MOTION, prefersReducedMotion } from '@/lib/motion'
import type { ReportTab } from '@/lib/reports-range'
import { cn } from '@/lib/utils'

export const TAB_LABELS: Record<ReportTab, string> = {
  overview: 'Overview',
  demand: 'Rides & demand',
  drivers: 'Drivers',
  finance: 'Finance',
}

interface Props {
  tabs: ReportTab[]
  active: ReportTab
  onChange: (t: ReportTab) => void
}

/**
 * Filled selection pill (design D7, DESIGN.md: selection is a fill, never a line) that slides between
 * tabs in 200 ms. WAI-ARIA tabs: roving tabindex, arrow keys, Home/End.
 */
export default function ReportTabs({ tabs, active, onChange }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const reduce = prefersReducedMotion()

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.indexOf(active)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    const t = tabs[next]!
    onChange(t)
    refs.current[t]?.focus()
  }

  return (
    <div role="tablist" aria-label="Report sections" onKeyDown={onKeyDown} className="inline-flex flex-wrap gap-1 p-1 rounded-full bg-surface-2 border border-border">
      {tabs.map(t => {
        const selected = t === active
        return (
          <button
            key={t}
            ref={el => { refs.current[t] = el }}
            type="button"
            role="tab"
            id={`report-tab-${t}`}
            aria-selected={selected}
            aria-controls={`report-panel-${t}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t)}
            className={cn(
              'relative min-h-[44px] px-5 rounded-full text-md font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              selected ? 'text-white' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {selected && (
              <motion.span
                layoutId="report-tab-pill"
                aria-hidden
                className="absolute inset-0 rounded-full bg-primary"
                transition={reduce ? { duration: MOTION.reducedMs / 1000 } : { duration: MOTION.tabMs / 1000, ease: MOTION.ease }}
              />
            )}
            <span className="relative">{TAB_LABELS[t]}</span>
          </button>
        )
      })}
    </div>
  )
}
