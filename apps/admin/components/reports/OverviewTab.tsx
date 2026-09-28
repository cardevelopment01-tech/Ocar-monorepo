'use client'
import { useCallback } from 'react'
import { StatBand, type BandDelta } from '@/components/ui/StatCard'
import { reportsApi, type KpisResponse, type Totals, type SeriesPoint } from '@/lib/reports-api'
import { useReportQuery } from '@/lib/use-report-query'
import {
  cancellationRate, completionRate, deltaText, int, inrCompact, pct, pointsDelta, relativeDelta, type Delta,
} from '@/lib/reports-format'
import TrendChart from './TrendChart'
import { EmptyState, ErrorCard, Panel, Refreshable, WidgetSkeleton } from './WidgetStates'
import { emptyActionFor, type ReportCtx } from './report-context'

type Tone = 'higherIsBetter' | 'lowerIsBetter'

function toBand(d: Delta | null, tone: Tone): BandDelta | null {
  if (!d) return null
  const good = tone === 'higherIsBetter' ? d.direction === 'up' : d.direction === 'down'
  const bad = tone === 'higherIsBetter' ? d.direction === 'down' : d.direction === 'up'
  return { text: deltaText(d), direction: d.direction, tone: d.direction === 'flat' ? 'neutral' : good ? 'good' : bad ? 'bad' : 'neutral' }
}

const dailyRate = (s: SeriesPoint, kind: 'completion' | 'cancellation') => {
  const d = s.cohort_completed + s.cohort_cancelled
  return d === 0 ? 0 : (kind === 'completion' ? s.cohort_completed : s.cohort_cancelled) / d
}

export default function OverviewTab({ ctx }: { ctx: ReportCtx }) {
  const { filters } = ctx
  const q = useReportQuery<KpisResponse>(useCallback((s: AbortSignal) => reportsApi.kpis(filters, s), [filters]), [filters])
  const d = q.data

  if (q.error && !d) {
    return <Panel title="Key numbers"><ErrorCard onRetry={q.reload} /></Panel>
  }

  const t: Totals | null = d?.totals ?? null
  const p: Totals | null = d?.previous_totals ?? null
  const hasMoney = !!d && !d.money_hidden
  const cmpHint = filters.compare === 'off' ? undefined : 'vs previous period'

  const cells = d && t ? [
    ...(hasMoney ? [
      {
        key: 'gross', title: 'Gross bookings', raw: t.gross_bookings ?? 0, fmt: inrCompact,
        delta: toBand(relativeDelta(t.gross_bookings ?? 0, p?.gross_bookings), 'higherIsBetter'),
        spark: d.series.map(s => s.gross ?? 0), go: ctx.isFinance ? () => ctx.goTab('finance') : undefined,
      },
      {
        key: 'commission', title: 'Ocar revenue', raw: t.commission ?? 0, fmt: inrCompact,
        delta: toBand(relativeDelta(t.commission ?? 0, p?.commission), 'higherIsBetter'),
        spark: d.series.map(s => s.commission ?? 0), go: ctx.isFinance ? () => ctx.goTab('finance') : undefined,
      },
    ] : []),
    {
      key: 'completed', title: 'Completed rides', raw: t.completed_rides, fmt: int,
      delta: toBand(relativeDelta(t.completed_rides, p?.completed_rides), 'higherIsBetter'),
      spark: d.series.map(s => s.completed_rides), go: () => ctx.goTab('demand'),
    },
    {
      key: 'completion', title: 'Completion', raw: (completionRate(t) ?? 0) * 100, fmt: (n: number) => `${Math.round(n)}%`, hint: 'of requests',
      delta: toBand(pointsDelta(completionRate(t), p ? completionRate(p) : null), 'higherIsBetter'),
      spark: d.series.map(s => dailyRate(s, 'completion')), go: () => ctx.goTab('demand'), none: completionRate(t) === null,
    },
    {
      key: 'cancellation', title: 'Cancellation', raw: (cancellationRate(t) ?? 0) * 100, fmt: (n: number) => `${Math.round(n)}%`, hint: 'of requests',
      delta: toBand(pointsDelta(cancellationRate(t), p ? cancellationRate(p) : null), 'lowerIsBetter'),
      spark: d.series.map(s => dailyRate(s, 'cancellation')), go: () => ctx.goTab('demand'), none: cancellationRate(t) === null,
    },
    {
      key: 'drivers', title: 'Active drivers', raw: t.active_drivers, fmt: int, hint: 'completed a ride',
      delta: toBand(relativeDelta(t.active_drivers, p?.active_drivers), 'higherIsBetter'),
      spark: undefined as number[] | undefined, go: () => ctx.goTab('drivers'),
    },
  ] : []

  const empty = !!d && d.series.every(s => (s.gross ?? 0) === 0 && s.completed_rides === 0 && s.cohort_completed + s.cohort_cancelled === 0)

  return (
    <div className="space-y-5">
      <section aria-label="Key numbers" className="admin-card !p-0 !cursor-default overflow-hidden">
        {q.loading || !d ? (
          <div className="flex flex-wrap divide-x divide-border-light">
            {Array.from({ length: 6 }).map((_, i) => <StatBand key={i} title="" value="" loading />)}
          </div>
        ) : (
          <Refreshable refreshing={q.refreshing}>
            <div className="flex flex-wrap divide-x divide-y divide-border-light lg:divide-y-0 [&>*]:border-border-light">
              {cells.map(c => (
                <StatBand
                  key={c.key} title={c.title} value={c.none ? '–' : c.fmt(c.raw)}
                  {...(c.none ? {} : { rawValue: c.raw, format: c.fmt })}
                  delta={c.delta}
                  hint={c.delta ? (c.hint ? `${c.hint} · ${cmpHint}` : cmpHint) : filters.compare === 'prev' ? (c.hint ? `${c.hint} · no comparison data` : 'no comparison data') : c.hint}
                  {...(c.spark ? { sparkline: c.spark } : {})}
                  {...(c.go ? { onClick: c.go } : {})}
                />
              ))}
            </div>
          </Refreshable>
        )}
      </section>

      <Panel
        title="Trend by day"
        note={d ? `Updated ${new Date(d.generated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Revenue and rides count on the day the ride completed; rates count rides by the day they were requested.` : undefined}
      >
        {q.loading || !d ? <div className="skeleton h-[220px] rounded" /> : q.error ? <ErrorCard onRetry={q.reload} /> : empty ? (
          <EmptyState message="No completed rides in this range." action={emptyActionFor(ctx)} />
        ) : (
          <Refreshable refreshing={q.refreshing}>
            <TrendChart series={d.series} previous={d.previous_series} moneyHidden={d.money_hidden} />
          </Refreshable>
        )}
      </Panel>
      {q.loading && <span className="sr-only"><WidgetSkeleton rows={1} /></span>}
    </div>
  )
}
