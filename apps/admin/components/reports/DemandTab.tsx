'use client'
import { useCallback, useMemo, useState } from 'react'
import { reportsApi, type DemandResponse, type EtaRow } from '@/lib/reports-api'
import { useReportQuery } from '@/lib/use-report-query'
import { inr, int, pct } from '@/lib/reports-format'
import { EmptyState, ErrorCard, Panel, Refreshable, WidgetSkeleton } from './WidgetStates'
import { emptyActionFor, type ReportCtx } from './report-context'
import { COLORS } from '@/lib/colors'
import { cn } from '@/lib/utils'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

// ── Funnel with drop-off between stages; Cancelled is a separate exit, not a stage ──
function Funnel({ f }: { f: DemandResponse['funnel'] }) {
  const stages = [
    { label: 'Requested', n: f.requested },
    { label: 'Accepted', n: f.accepted },
    { label: 'Completed', n: f.completed },
  ]
  const max = Math.max(f.requested, 1)
  return (
    <div>
      <ol className="space-y-3">
        {stages.map((s, i) => {
          const prev = i === 0 ? null : stages[i - 1]!.n
          const drop = prev && prev > 0 ? 1 - s.n / prev : null
          return (
            <li key={s.label}>
              <div className="flex items-baseline justify-between text-md">
                <span className="text-text-primary font-medium">{s.label}</span>
                <span className="text-text-primary">
                  <span className="font-mono tabular-nums">{int(s.n)}</span>
                  {drop !== null && <span className="text-text-secondary"> · {pct(drop)} drop-off</span>}
                </span>
              </div>
              <div className="mt-1 h-3 rounded-full bg-surface-3 overflow-hidden" aria-hidden>
                <div className="h-full rounded-full transition-[width] duration-[250ms] ease-out motion-reduce:transition-none" style={{ width: `${(s.n / max) * 100}%`, background: COLORS.primary }} />
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-md text-text-secondary">
        Cancelled: <span className="font-mono tabular-nums text-text-primary">{int(f.cancelled)}</span>
        {f.requested > 0 && <> ({pct(f.cancelled / f.requested)} of requests) — counted separately, not a funnel stage.</>}
      </p>
    </div>
  )
}

// ── Demand heatmap (IST weekday x hour) with a table alternative ──────────────
function Heatmap({ cells }: { cells: DemandResponse['heatmap'] }) {
  const [asTable, setAsTable] = useState(false)
  const grid = useMemo(() => {
    const m = new Map<string, number>()
    let max = 0
    for (const c of cells) { m.set(`${c.dow}-${c.hour}`, c.count); max = Math.max(max, c.count) }
    return { m, max }
  }, [cells])
  const top = useMemo(() => [...cells].sort((a, b) => b.count - a.count).slice(0, 12), [cells])

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button type="button" onClick={() => setAsTable(v => !v)} aria-pressed={asTable} className="btn-secondary min-h-[44px]">
          {asTable ? 'View as heatmap' : 'View as table'}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="report-table">
            <thead><tr><th>Day</th><th>Hour (IST)</th><th className="num">Rides requested</th></tr></thead>
            <tbody>{top.map(c => <tr key={`${c.dow}-${c.hour}`}><td>{DOW[c.dow]}</td><td>{hourLabel(c.hour)}</td><td className="num">{int(c.count)}</td></tr>)}</tbody>
          </table>
          <p className="text-base text-text-secondary mt-2">Busiest 12 slots.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div role="img" aria-label="Rides requested by weekday and hour, IST. Darker means more rides." className="min-w-[560px]">
            <div className="grid gap-[3px]" style={{ gridTemplateColumns: '36px repeat(24, minmax(0, 1fr))' }}>
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="text-sm text-text-muted text-center">{h % 6 === 0 ? hourLabel(h) : ''}</span>
              ))}
              {DOW.map((d, dow) => (
                <div key={d} className="contents">
                  <span className="text-sm text-text-secondary self-center">{d}</span>
                  {Array.from({ length: 24 }, (_, h) => {
                    const n = grid.m.get(`${dow}-${h}`) ?? 0
                    const a = grid.max === 0 ? 0 : n / grid.max
                    return (
                      <span
                        key={h}
                        title={`${d} ${hourLabel(h)}: ${n} ride${n === 1 ? '' : 's'}`}
                        className="h-6 rounded-[4px]"
                        style={{ background: n === 0 ? COLORS.primaryLight : `rgba(14,143,163,${0.18 + a * 0.82})` }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3 text-base text-text-secondary" aria-hidden>
            Fewer
            {[0.18, 0.4, 0.62, 0.82, 1].map(a => <span key={a} className="inline-block w-6 h-3 rounded-[3px]" style={{ background: `rgba(14,143,163,${a})` }} />)}
            More
          </div>
        </div>
      )}
    </div>
  )
}

function ShowAllTable({ rows, cols, limit = 5, label }: {
  rows: Record<string, React.ReactNode>[]; cols: { key: string; label: string; num?: boolean }[]; limit?: number; label: string
}) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, limit)
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="report-table">
          <thead><tr>{cols.map(c => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>{shown.map((r, i) => <tr key={i}>{cols.map(c => <td key={c.key} className={c.num ? 'num' : ''}>{r[c.key]}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(v => !v)} className="btn-secondary min-h-[44px] mt-3" aria-label={`${all ? 'Show fewer' : 'Show all'} ${label}`}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  )
}

export default function DemandTab({ ctx }: { ctx: ReportCtx }) {
  const { filters } = ctx
  const q = useReportQuery<DemandResponse>(useCallback((s: AbortSignal) => reportsApi.demand(filters, s), [filters]), [filters])
  const eta = useReportQuery<EtaRow[]>(useCallback((s: AbortSignal) => reportsApi.eta(filters, s), [filters]), [filters])
  const d = q.data
  const empty = !!d && d.funnel.requested === 0
  const action = emptyActionFor(ctx)

  const cityRows = useMemo(() => (d?.cities ?? []).filter(c => c.ride_count > 0 || c.cancelled_count > 0), [d])
  const zeroCities = (d?.cities.length ?? 0) - cityRows.length
  const showRevenue = !!d && d.cities.some(c => c.revenue !== undefined)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title="Ride funnel" note="Rides requested in the range, and how many reached each stage.">
          {q.loading || !d ? <WidgetSkeleton /> : q.error ? <ErrorCard onRetry={q.reload} /> : empty ? <EmptyState message="No rides were requested in this range." action={action} /> : <Refreshable refreshing={q.refreshing}><Funnel f={d.funnel} /></Refreshable>}
        </Panel>
        <Panel title="Why rides were cancelled" note="Who cancelled, at which stage, and the reason given.">
          {q.loading || !d ? <WidgetSkeleton /> : q.error ? <ErrorCard onRetry={q.reload} /> : d.cancellations.length === 0 ? <EmptyState message="No cancellations in this range." action={action} /> : (
            <Refreshable refreshing={q.refreshing}>
              <ShowAllTable label="cancellation reasons" limit={6}
                cols={[{ key: 'who', label: 'Cancelled by' }, { key: 'stage', label: 'Stage' }, { key: 'reason', label: 'Reason' }, { key: 'n', label: 'Rides', num: true }]}
                rows={d.cancellations.map(c => ({ who: titleCase(c.actor), stage: titleCase(c.stage), reason: titleCase(c.reason_code), n: int(c.count) }))} />
            </Refreshable>
          )}
        </Panel>
      </div>

      <Panel title="When rides are requested" note="Rides requested by weekday and hour (IST). Darker means busier.">
        {q.loading || !d ? <div className="skeleton h-40 rounded" /> : q.error ? <ErrorCard onRetry={q.reload} /> : d.heatmap.length === 0 ? <EmptyState message="No rides were requested in this range." action={action} /> : <Refreshable refreshing={q.refreshing}><Heatmap cells={d.heatmap} /></Refreshable>}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-5">
        <Panel title="By city" note="Completed rides by the day they finished. Cancellation rate counts rides by the day they were requested.">
          {q.loading || !d ? <WidgetSkeleton /> : q.error ? <ErrorCard onRetry={q.reload} /> : cityRows.length === 0 ? <EmptyState message="No city has rides in this range." action={action} /> : (
            <Refreshable refreshing={q.refreshing}>
              <ShowAllTable label="cities"
                cols={[{ key: 'city', label: 'City' }, { key: 'rides', label: 'Completed', num: true }, ...(showRevenue ? [{ key: 'rev', label: 'Gross bookings', num: true }] : []), { key: 'canc', label: 'Cancelled', num: true }, { key: 'rate', label: 'Cancel rate', num: true }, { key: 'fleet', label: 'Active fleet', num: true }]}
                rows={cityRows.map(c => ({ city: c.city_name, rides: int(c.ride_count), rev: c.revenue === undefined ? '' : inr(c.revenue), canc: int(c.cancelled_count), rate: pct(c.cancellation_rate), fleet: int(c.active_drivers) }))} />
              {zeroCities > 0 && <p className="text-base text-text-secondary mt-3">{zeroCities} more {zeroCities === 1 ? 'city has' : 'cities have'} no rides in this range.</p>}
            </Refreshable>
          )}
        </Panel>
        <Panel title="By vehicle category" note="Completed rides by the day they finished.">
          {q.loading || !d ? <WidgetSkeleton /> : q.error ? <ErrorCard onRetry={q.reload} /> : d.categories.every(c => c.ride_count === 0) ? <EmptyState message="No completed rides in this range." action={action} /> : (
            <Refreshable refreshing={q.refreshing}>
              <ul className="space-y-3">
                {(() => { const max = Math.max(...d.categories.map(c => c.ride_count), 1); return d.categories.filter(c => c.ride_count > 0).map(c => (
                  <li key={c.category_name}>
                    <div className="flex items-baseline justify-between text-md"><span className="text-text-primary font-medium">{c.category_name}</span><span className="font-mono tabular-nums">{int(c.ride_count)}</span></div>
                    <div className="mt-1 h-3 rounded-full bg-surface-3 overflow-hidden" aria-hidden><div className="h-full rounded-full transition-[width] duration-[250ms] ease-out motion-reduce:transition-none" style={{ width: `${(c.ride_count / max) * 100}%`, background: COLORS.primary }} /></div>
                  </li>
                )) })()}
              </ul>
            </Refreshable>
          )}
        </Panel>
      </div>

      <Panel title="Route time estimates vs actual" note="How close the predicted trip time was to the real one (lower is better).">
        {eta.loading || !eta.data ? (eta.error ? <ErrorCard onRetry={eta.reload} /> : <WidgetSkeleton rows={2} />) : eta.data.length === 0 ? <EmptyState message="No trips with route estimates in this range." action={action} /> : (
          <Refreshable refreshing={eta.refreshing}>
            <ShowAllTable label="routes" limit={6}
              cols={[{ key: 'route', label: 'Route' }, { key: 'leg', label: 'Leg' }, { key: 'n', label: 'Trips', num: true }, { key: 'mae', label: 'Avg error', num: true }, { key: 'mape', label: 'Error %', num: true }]}
              rows={eta.data.map(r => ({ route: `${r.origin_city ?? '–'} → ${r.destination_city ?? '–'}`, leg: r.leg === 'to_pickup' ? 'To pickup' : 'To destination', n: int(r.sample_count), mae: `${r.mae_min.toFixed(1)} min`, mape: r.mape_pct === null ? '–' : `${r.mape_pct.toFixed(0)}%` }))} />
          </Refreshable>
        )}
      </Panel>
      <span className={cn('sr-only')} aria-live="polite">{q.refreshing ? 'Updating' : ''}</span>
    </div>
  )
}
