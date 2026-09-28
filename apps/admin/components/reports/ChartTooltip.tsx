'use client'
import { longDate } from '@/lib/reports-format'

export interface TooltipRow { label: string; value: string; dashed?: boolean; color?: string }

/** The one tooltip surface used by every Reports chart: label, then value rows. */
export function TooltipCard({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  return (
    <div
      className="rounded-lg bg-surface border border-border px-3 py-2 text-base"
      style={{ boxShadow: '0 4px 20px rgba(14,143,163,0.12)' }}
    >
      {title && <p className="font-semibold text-text-primary mb-1">{title}</p>}
      <ul className="space-y-0.5">
        {rows.map(r => (
          <li key={r.label} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2 text-text-secondary">
              {r.color && (
                <span
                  aria-hidden
                  className="inline-block w-3 h-0"
                  style={{ borderTop: `2px ${r.dashed ? 'dashed' : 'solid'} ${r.color}` }}
                />
              )}
              {r.label}
            </span>
            <span className="font-mono tabular-nums text-text-primary">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** recharts `content` adapter for date-keyed series. */
export function dateTooltip(rowsFor: (payload: Record<string, unknown>) => TooltipRow[]) {
  // eslint-disable-next-line react/display-name
  return ({ active, payload }: { active?: boolean; payload?: { payload: Record<string, unknown> }[] }) => {
    if (!active || !payload?.length) return null
    const p = payload[0]!.payload
    return <TooltipCard title={typeof p['day'] === 'string' ? longDate(p['day']) : undefined} rows={rowsFor(p)} />
  }
}
