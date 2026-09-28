'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Star } from 'lucide-react'
import { reportsApi, type AvailabilityRow, type DriverQualityRow, type DriversResponse, type OnboardingRow } from '@/lib/reports-api'
import { useReportQuery } from '@/lib/use-report-query'
import { inr, int, pct } from '@/lib/reports-format'
import { EmptyState, ErrorCard, Panel, Refreshable, WidgetSkeleton } from './WidgetStates'
import { emptyActionFor, type ReportCtx } from './report-context'
import { cn } from '@/lib/utils'

type SortKey = 'completed' | 'acceptance' | 'cancellation' | 'earnings' | 'rating'

const sortValue = (r: DriverQualityRow, k: SortKey): number => {
  switch (k) {
    case 'completed': return r.completed
    case 'acceptance': return r.acceptance_rate ?? -1
    case 'cancellation': return r.cancellation_rate ?? -1
    case 'earnings': return r.earnings ?? 0
    case 'rating': return r.rating_avg ? parseFloat(r.rating_avg) : -1
  }
}

/** Good / watch / bad are always words as well as colour. */
function Health({ pctValue, low, ok }: { pctValue: number; low: number; ok: number }) {
  const [label, cls] = pctValue < low ? ['Low', 'bg-danger-light text-danger'] : pctValue < ok ? ['Watch', 'bg-warning-light text-warning'] : ['Healthy', 'bg-success-light text-success']
  return <span className={cn('pill', cls)}>{label}</span>
}

function useSecondsAgo(t: number | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  if (t === null) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  return s < 5 ? 'Updated just now' : s < 60 ? `Updated ${s}s ago` : `Updated ${Math.round(s / 60)} min ago`
}

export default function DriversTab({ ctx }: { ctx: ReportCtx }) {
  const { filters } = ctx
  const q = useReportQuery<DriversResponse>(useCallback((s: AbortSignal) => reportsApi.drivers(filters, s), [filters]), [filters])
  const onboarding = useReportQuery<OnboardingRow[]>(useCallback((s: AbortSignal) => reportsApi.onboarding(filters, s), [filters]), [filters])
  // Live snapshot: not period-scoped, polled in place (no skeleton flash) with a visible age.
  const live = useReportQuery<AvailabilityRow[]>(useCallback((s: AbortSignal) => reportsApi.availability(s), []), [], { pollMs: 60_000 })
  const ago = useSecondsAgo(live.updatedAt)

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'completed', dir: 'desc' })
  const hasEarnings = !!q.data?.quality.some(r => r.earnings !== undefined)
  const rows = useMemo(() => {
    const list = [...(q.data?.quality ?? [])]
    list.sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * (sort.dir === 'asc' ? 1 : -1))
    return list
  }, [q.data, sort])
  const action = emptyActionFor(ctx)

  const th = (key: SortKey, label: string) => (
    <th className="num" aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 min-h-[44px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
        onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
        {label}
        {sort.key === key && (sort.dir === 'desc' ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
      </button>
    </th>
  )

  return (
    <div className="space-y-5">
      <Panel title="Driver quality" note="Offers and acceptance for the range; completion and cancellation count the driver's rides by the day they were requested.">
        {q.loading || !q.data ? (q.error ? <ErrorCard onRetry={q.reload} /> : <WidgetSkeleton rows={5} height="h-10" />) : rows.length === 0 ? (
          <EmptyState message="No driver had offers or trips in this range." action={action} />
        ) : (
          <Refreshable refreshing={q.refreshing}>
            <div className="overflow-x-auto">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    {th('completed', 'Completed')}
                    {th('acceptance', 'Acceptance')}
                    {th('cancellation', 'Cancelled')}
                    {hasEarnings && th('earnings', 'Earnings')}
                    {th('rating', 'Rating')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.driver_id}>
                      <td>
                        <Link href={`/drivers?q=${encodeURIComponent(r.driver_code)}`} className="font-semibold text-primary-dark hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
                          {r.driver_name ?? 'Unnamed driver'}
                        </Link>
                        <span className="block text-base text-text-secondary">{r.driver_code}</span>
                      </td>
                      <td className="num">{int(r.completed)}</td>
                      <td className="num">{r.acceptance_rate === null ? '–' : <>{pct(r.acceptance_rate)} <span className="text-text-secondary">({r.accepted}/{r.offered})</span></>}</td>
                      <td className="num">{r.cancellation_rate === null ? '–' : `${pct(r.cancellation_rate)} (${r.cancelled})`}</td>
                      {hasEarnings && <td className="num">{inr(r.earnings ?? 0)}</td>}
                      <td className="num">{r.rating_avg && parseFloat(r.rating_avg) > 0 ? <span className="inline-flex items-center gap-1 justify-end"><Star size={12} className="text-accent-amber fill-accent-amber" aria-hidden />{parseFloat(r.rating_avg).toFixed(1)}</span> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Refreshable>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title="Driver onboarding by city" note="Signups in the range. A low conversion means onboarding is stalling in that city.">
          {onboarding.loading || !onboarding.data ? (onboarding.error ? <ErrorCard onRetry={onboarding.reload} /> : <WidgetSkeleton />) : onboarding.data.length === 0 ? (
            <EmptyState message="No driver signups in this range." action={action} />
          ) : (
            <Refreshable refreshing={onboarding.refreshing}>
              <div className="overflow-x-auto">
                <table className="report-table">
                  <thead><tr><th>City</th><th className="num">Signed up</th><th className="num">Docs in</th><th className="num">Activated</th><th className="num">Conversion</th><th className="num">Avg hours to active</th></tr></thead>
                  <tbody>
                    {onboarding.data.map(r => (
                      <tr key={r.city_name}>
                        <td className="font-semibold text-text-primary">{r.city_name}</td>
                        <td className="num">{int(r.signed_up)}</td><td className="num">{int(r.docs_submitted)}</td><td className="num">{int(r.activated)}</td>
                        <td className="num"><span className="mr-2">{r.conversion_pct.toFixed(0)}%</span><Health pctValue={r.conversion_pct} low={30} ok={50} /></td>
                        <td className="num">{r.avg_hours_to_active == null ? '–' : `${r.avg_hours_to_active.toFixed(0)}h`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Refreshable>
          )}
        </Panel>

        <Panel title="Driver availability by city" note="Live snapshot, not tied to the date range." right={<span className="text-base text-text-secondary" aria-live="polite">{ago}</span>}>
          {live.loading || !live.data ? (live.error ? <ErrorCard onRetry={live.reload} /> : <WidgetSkeleton />) : live.data.length === 0 ? (
            <EmptyState message="No active drivers right now." />
          ) : (
            <div className="overflow-x-auto">
              <table className="report-table">
                <thead><tr><th>City</th><th className="num">Active</th><th className="num">Online now</th><th className="num">Available now</th><th className="num">Availability</th></tr></thead>
                <tbody>
                  {live.data.map(r => (
                    <tr key={r.city_name}>
                      <td className="font-semibold text-text-primary">{r.city_name}</td>
                      <td className="num">{int(r.total_active)}</td><td className="num">{int(r.online_now)}</td><td className="num">{int(r.available_now)}</td>
                      <td className="num"><span className="mr-2">{r.availability_pct.toFixed(0)}%</span><Health pctValue={r.availability_pct} low={30} ok={50} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
