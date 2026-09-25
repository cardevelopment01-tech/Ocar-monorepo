'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { ChevronDown, Info, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import SuccessToast from '@/components/ui/SuccessToast'
import { cn } from '@/lib/utils'
import { buildSections } from '@/lib/system-config-model'
import ConfigRow from './ConfigRow'
import ReviewDialog from './ReviewDialog'
import SaveBar from './SaveBar'
import SectionRail, { type RailItem } from './SectionRail'
import { useConfigEditor } from './useConfigEditor'

function isTypingTarget(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable)
}

function Skeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading settings">
      {[3, 2, 3].map((rows, s) => (
        <div key={s}>
          <div className="mb-3 h-6 w-48 animate-pulse rounded-lg bg-surface-3 motion-reduce:animate-none" />
          <div className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border bg-surface">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-8 px-5 py-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-56 animate-pulse rounded bg-surface-3 motion-reduce:animate-none" />
                  <div className="h-3 w-full max-w-[420px] animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
                </div>
                <div className="h-11 w-[240px] animate-pulse rounded-xl bg-surface-3 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SystemConfigPage() {
  const ed = useConfigEditor()
  const reduce = useReducedMotion()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sections = useMemo(() => buildSections(ed.configs, query), [ed.configs, query])
  const invalidCount = ed.changes.filter(c => c.error).length
  const errorById = useMemo(
    () => Object.fromEntries(ed.changes.filter(c => c.error).map(c => [c.r.config.id, c.error as string])),
    [ed.changes],
  )
  const failedCount = Object.keys(ed.rowNotes).length
  const searching = query.trim() !== ''

  const railItems: RailItem[] = sections.map(s => ({
    id: s.group.id,
    title: s.group.title,
    count: s.items.length,
    dirty: s.items.filter(i => i.config.id in ed.drafts).length,
  }))

  // "/" jumps to search, like GitHub / Linear / Stripe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Don't lose unsaved edits to a reload / tab close.
  const dirtyCount = ed.changes.length
  useEffect(() => {
    if (dirtyCount === 0) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  // Scroll-spy for the rail.
  useEffect(() => {
    const els = sections.map(s => document.getElementById(`section-${s.group.id}`)).filter((e): e is HTMLElement => !!e)
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top) setActiveId(top.target.id.replace('section-', ''))
    }, { rootMargin: '-15% 0px -70% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [sections])

  // After a save with problems, bring the first affected row into view.
  const firstFailedId = Object.keys(ed.rowNotes)[0]
  useEffect(() => {
    if (firstFailedId) document.getElementById(`cfg-${firstFailedId}`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [firstFailedId, reduce])

  const selectSection = useCallback((id: string) => {
    setActiveId(id)
    if (id === 'legacy') setLegacyOpen(true)
    requestAnimationFrame(() =>
      document.getElementById(`section-${id}`)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }))
  }, [reduce])

  const handleConfirm = async () => {
    const { saved } = await ed.save()
    setReviewOpen(false)
    if (saved > 0) setToast(`${saved} ${saved === 1 ? 'setting' : 'settings'} updated`)
  }

  const activeRail = activeId ?? railItems[0]?.id ?? null

  return (
    <div className="mx-auto max-w-[1120px] pb-6">
      <SuccessToast message={toast} onDismiss={() => setToast(null)} />

      {/* Toolbar: search + one honest line about what saving does. Floats over the scroll (glass = floating chrome). */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 bg-canvas/90 px-6 pb-4 pt-6 backdrop-blur-md">
        <div className="relative w-full max-w-[480px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
            aria-label="Search settings"
            placeholder="Search settings"
            className="min-h-[44px] w-full rounded-xl border border-border bg-surface pl-10 pr-12 text-md text-text-primary outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {searching ? (
            <button
              type="button"
              onClick={() => { setQuery(''); searchRef.current?.focus() }}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-text-muted sm:block" aria-hidden="true">/</kbd>
          )}
        </div>
        <p className="flex items-center gap-2 text-base text-text-secondary">
          <Info size={14} className="flex-shrink-0 text-text-muted" aria-hidden="true" />
          Saved changes reach live rides and payments right away.
        </p>
      </div>

      {failedCount > 0 && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-danger-light px-5 py-4 text-md text-red-900">
          <TriangleAlert size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">{failedCount} {failedCount === 1 ? 'setting wasn’t' : 'settings weren’t'} saved.</span>{' '}
            Your edits are still here. See the highlighted {failedCount === 1 ? 'row' : 'rows'} for what to do.
          </p>
        </div>
      )}

      {ed.status === 'loading' && <Skeleton />}

      {ed.status === 'error' && (
        <div role="alert" className="rounded-2xl border border-border bg-surface px-6 py-10 text-center shadow-card">
          <TriangleAlert size={28} className="mx-auto text-red-700" aria-hidden="true" />
          <h2 className="mt-3 font-display text-xl font-bold text-text-primary">Couldn’t load settings</h2>
          <p className="mx-auto mt-1 max-w-[46ch] text-md text-text-secondary">{ed.loadError}</p>
          <button
            type="button"
            onClick={() => void ed.load()}
            className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-md font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {ed.status === 'ready' && (
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-[210px_minmax(0,1fr)]">
          {sections.length > 0 && <SectionRail items={railItems} activeId={activeRail} onSelect={selectSection} />}

          <div className="min-w-0 space-y-10">
            {sections.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-12 text-center">
                <p className="text-lg font-semibold text-text-primary">
                  {searching ? <>No settings match “{query.trim()}”</> : 'No settings found'}
                </p>
                {searching && (
                  <>
                    <p className="mt-1 text-md text-text-secondary">Try a setting name, a key like <code className="font-mono">payout</code>, or a group.</p>
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="mt-4 min-h-[44px] rounded-xl border border-border px-5 text-md font-semibold text-text-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Show all settings
                    </button>
                  </>
                )}
              </div>
            )}

            {sections.map(({ group, items }) => {
              const isLegacy = group.id === 'legacy'
              const hasDirty = items.some(i => i.config.id in ed.drafts)
              const expanded = !isLegacy || legacyOpen || searching || hasDirty
              const headingId = `heading-${group.id}`
              return (
                <section key={group.id} id={`section-${group.id}`} aria-labelledby={headingId} className="scroll-mt-28">
                  <div className="mb-3 flex items-end justify-between gap-4 px-1">
                    <div>
                      <h2 id={headingId} className="font-display text-xl font-bold text-text-primary">{group.title}</h2>
                      <p className="text-md text-text-secondary">{group.blurb}</p>
                    </div>
                    {isLegacy && (
                      <button
                        type="button"
                        onClick={() => setLegacyOpen(o => !o)}
                        aria-expanded={expanded}
                        aria-controls="legacy-rows"
                        disabled={searching || hasDirty}
                        className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-xl px-3 text-md font-semibold text-primary-dark hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                      >
                        {expanded ? 'Hide' : `Show ${items.length}`}
                        <ChevronDown size={16} className={cn('transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div
                      id={isLegacy ? 'legacy-rows' : undefined}
                      className={cn(
                        'divide-y divide-border-light overflow-hidden rounded-2xl border border-border bg-surface shadow-card',
                        isLegacy && 'opacity-80',
                      )}
                    >
                      {items.map(r => (
                        <ConfigRow
                          key={r.config.id}
                          r={r}
                          draft={ed.drafts[r.config.id]}
                          error={errorById[r.config.id] ?? null}
                          note={ed.rowNotes[r.config.id]}
                          onChange={v => ed.setDraft(r.config.id, v)}
                          onReset={() => ed.resetDraft(r.config.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      )}

      <SaveBar
        changeCount={ed.changes.length}
        invalidCount={invalidCount}
        saving={ed.saving}
        onDiscard={ed.discardAll}
        onReview={() => setReviewOpen(true)}
      />
      <ReviewDialog
        open={reviewOpen}
        changes={ed.changes}
        saving={ed.saving}
        onCancel={() => setReviewOpen(false)}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  )
}
