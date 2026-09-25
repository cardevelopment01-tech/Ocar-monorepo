'use client'

import { RotateCcw, TriangleAlert } from 'lucide-react'
import Toggle from '@/components/ui/Toggle'
import { cn } from '@/lib/utils'
import { relativeTime, type Resolved } from '@/lib/system-config-model'

interface Props {
  r: Resolved
  /** The admin's unsaved value, if any. */
  draft: string | undefined
  /** Inline validation problem for the draft. */
  error: string | null
  /** A server-side problem from the last save (conflict, rejected value). */
  note: string | undefined
  onChange: (value: string) => void
  onReset: () => void
}

const INPUT_BASE =
  'w-full bg-transparent px-3 py-[11px] text-md text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60'

export default function ConfigRow({ r, draft, error, note, onChange, onReset }: Props) {
  const { config } = r
  const dirty = draft !== undefined
  const value = draft ?? config.value
  const id = `cfg-${config.id}`
  const titleId = `${id}-title`
  const helpId = `${id}-help`
  const msgId = `${id}-msg`
  const describedBy = [r.help ? helpId : '', error || note ? msgId : ''].filter(Boolean).join(' ') || undefined
  const invalid = Boolean(error)

  return (
    <div
      id={`row-${config.key}`}
      className={cn(
        'grid gap-3 px-5 py-4 transition-colors duration-150 motion-reduce:transition-none md:grid-cols-[minmax(0,1fr)_240px] md:gap-8',
        dirty ? 'bg-primary-light/60' : 'bg-surface',
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <label id={titleId} htmlFor={r.kind === 'switch' ? undefined : id} className="text-md font-semibold text-text-primary">
            {r.title}
          </label>
          {r.critical && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-sm font-semibold text-amber-800">
              <TriangleAlert size={12} aria-hidden="true" />
              Live impact
            </span>
          )}
          {dirty && (
            <>
              <span className="rounded-full bg-primary px-2 py-0.5 text-sm font-semibold text-white">Edited</span>
              <button
                type="button"
                onClick={onReset}
                aria-label={`Undo edit to ${r.title}`}
                className="relative inline-flex items-center gap-1 rounded text-sm font-semibold text-primary-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary after:absolute after:-inset-x-2 after:-inset-y-3.5"
              >
                <RotateCcw size={12} aria-hidden="true" />
                Undo
              </button>
            </>
          )}
        </div>
        {r.help && <p id={helpId} className="mt-1 max-w-[62ch] text-base text-text-secondary">{r.help}</p>}
        <p className="mt-1.5 text-sm text-text-muted">
          <code className="font-mono">{config.key}</code>
          <span aria-hidden="true"> · </span>
          <span title={new Date(config.updatedAt).toLocaleString('en-IN')}>Updated {relativeTime(config.updatedAt)}</span>
        </p>
      </div>

      <div className="flex w-full flex-col gap-1.5 md:items-end">
        {r.kind === 'switch' ? (
          <div className="flex items-center gap-3 py-1.5">
            <span className={cn('text-md font-semibold', value === 'true' ? 'text-text-primary' : 'text-text-muted')} aria-hidden="true">
              {value === 'true' ? 'On' : 'Off'}
            </span>
            <Toggle
              checked={value === 'true'}
              onChange={v => onChange(v ? 'true' : 'false')}
              labelledBy={titleId}
              describedBy={describedBy}
            />
          </div>
        ) : r.kind === 'json' ? (
          <textarea
            id={id}
            value={value}
            rows={4}
            spellCheck={false}
            onChange={e => onChange(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={cn(INPUT_BASE, 'rounded-xl border bg-surface-2 font-mono focus:border-primary focus:ring-2 focus:ring-primary/20', invalid ? 'border-red-600' : 'border-border')}
          />
        ) : (
          <div
            className={cn(
              'flex min-h-[44px] items-center rounded-xl border bg-surface-2 transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
              // numbers sit in a compact field so the unit stays next to its value; free text gets the full column
              r.kind === 'number' ? 'w-full md:w-[176px]' : 'w-full',
              invalid ? 'border-red-600' : 'border-border',
            )}
          >
            {r.prefix && <span className="pl-3 text-md text-text-muted" aria-hidden="true">{r.prefix}</span>}
            <input
              id={id}
              type="text"
              inputMode={r.kind === 'number' ? 'decimal' : 'text'}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={e => onChange(e.target.value)}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className={cn(INPUT_BASE, r.kind === 'number' ? cn('font-mono tabular-nums', r.prefix ? 'text-left' : 'text-right') : 'font-mono')}
            />
            {r.suffix && <span className="whitespace-nowrap pr-3 text-md text-text-muted" aria-hidden="true">{r.suffix.trim()}</span>}
          </div>
        )}

        <div id={msgId} className="w-full md:text-right" aria-live="polite">
          {error && <p className="text-base font-medium text-red-700">{error}</p>}
          {!error && note && <p className="text-base font-medium text-amber-800">{note}</p>}
          {!error && !note && dirty && r.kind === 'number' && config.min !== null && config.max !== null && (
            <p className="text-sm text-text-muted">
              Allowed: {config.min.toLocaleString('en-IN')} to {config.max.toLocaleString('en-IN')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
