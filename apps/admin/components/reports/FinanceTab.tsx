'use client'
import { useCallback } from 'react'
import Link from 'next/link'
import { reportsApi, type FinanceResponse } from '@/lib/reports-api'
import { useReportQuery } from '@/lib/use-report-query'
import { inr, int, pct, pointsDelta, deltaText } from '@/lib/reports-format'
import { EmptyState, ErrorCard, Panel, Refreshable, WidgetSkeleton } from './WidgetStates'
import { emptyActionFor, type ReportCtx } from './report-context'

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <tr>
      <td>{label}{hint && <span className="block text-base text-text-secondary">{hint}</span>}</td>
      <td className="num">{value}</td>
    </tr>
  )
}

/** Finance tab: finance class only (the API answers 403 to ops_admin, and the tab is not offered to them). */
export default function FinanceTab({ ctx }: { ctx: ReportCtx }) {
  const { filters } = ctx
  const q = useReportQuery<FinanceResponse>(useCallback((s: AbortSignal) => reportsApi.finance(filters, s), [filters]), [filters])
  const d = q.data

  if (q.error && !d) return <Panel title="Finance"><ErrorCard onRetry={q.reload} /></Panel>
  if (q.loading || !d) {
    return <div className="grid grid-cols-1 xl:grid-cols-2 gap-5"><Panel title="Money"><WidgetSkeleton rows={5} /></Panel><Panel title="Cash collection"><WidgetSkeleton rows={4} /></Panel></div>
  }

  const empty = d.totals.completed_rides === 0 && d.totals.gross_bookings === 0
  const takeDelta = filters.compare === 'prev' && d.previous_take_rate !== null ? pointsDelta(d.take_rate, d.previous_take_rate) : null
  const cashPct = d.finance.cash_gross + d.finance.online_gross === 0 ? null : d.finance.cash_gross / (d.finance.cash_gross + d.finance.online_gross)
  const gap = d.cash.net_gap
  const gapText = gap === 0 ? inr(0) : gap > 0 ? `${inr(gap)} short` : `${inr(-gap)} over`

  return (
    <div className="space-y-5">
      <Refreshable refreshing={q.refreshing} className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title="Money" note="Payments completed for rides that finished in the range.">
          {empty ? <EmptyState message="No payments in this range." action={emptyActionFor(ctx)} /> : (
            <table className="report-table">
              <tbody>
                <Row label="Gross bookings" value={inr(d.totals.gross_bookings)} />
                <Row label="Ocar revenue (commission)" value={inr(d.totals.commission)} />
                <Row label="Driver earnings" value={inr(d.finance.driver_earnings)} />
                <Row label="Take rate" value={`${pct(d.take_rate, 1)}${takeDelta ? ` (${deltaText(takeDelta)})` : ''}`} hint="Ocar revenue as a share of gross bookings" />
                <Row label="Paid in cash" value={inr(d.finance.cash_gross)} hint={cashPct === null ? undefined : `${pct(cashPct)} of gross`} />
                <Row label="Paid online" value={inr(d.finance.online_gross)} />
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Cash collection" note="Rides finished in the range where the cash the driver collected did not match the fare.">
          <table className="report-table">
            <tbody>
              <Row label="Flagged rides" value={int(d.cash.flagged_count)} />
              <Row label="Nothing collected" value={int(d.cash.not_collected_count)} />
              <Row label="Net difference" value={gapText} hint="Fare minus cash collected" />
            </tbody>
          </table>
          <Link href="/rides?cash=flagged" className="btn-secondary min-h-[44px] mt-4 inline-flex">Open flagged rides</Link>
          <p className="text-base text-text-secondary mt-2">The rides list is not limited to this date range.</p>
        </Panel>
      </Refreshable>

      <Panel title="Refunds and disputes" note="Working definitions, to be confirmed by finance. Counted in the window where the refund was processed or the dispute was opened, not by the ride's date.">
        <Refreshable refreshing={q.refreshing}>
          <table className="report-table">
            <thead><tr><th>Measure</th><th className="num">Count</th><th className="num">Per 100 completed rides</th><th className="num">Amount</th></tr></thead>
            <tbody>
              <tr><td>Refunds completed</td><td className="num">{int(d.finance.refund_count)}</td><td className="num">{d.finance.refunds_per_100.toFixed(1)}</td><td className="num">{inr(d.finance.refund_amount)}</td></tr>
              <tr><td>Disputes opened (not withdrawn)</td><td className="num">{int(d.finance.dispute_count)}</td><td className="num">{d.finance.disputes_per_100.toFixed(1)}</td><td className="num">–</td></tr>
            </tbody>
          </table>
        </Refreshable>
      </Panel>
    </div>
  )
}
