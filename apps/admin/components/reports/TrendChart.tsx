'use client'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLORS } from '@/lib/colors'
import { MOTION, prefersReducedMotion } from '@/lib/motion'
import { inr, inrCompact, int, shortDate } from '@/lib/reports-format'
import type { SeriesPoint } from '@/lib/reports-api'
import { dateTooltip, type TooltipRow } from './ChartTooltip'
import { cn } from '@/lib/utils'

export type Metric = 'gross' | 'commission' | 'rides'
const METRICS: { key: Metric; label: string; money: boolean }[] = [
  { key: 'gross', label: 'Gross bookings', money: true },
  { key: 'commission', label: 'Ocar revenue', money: true },
  { key: 'rides', label: 'Completed rides', money: false },
]

function valueOf(p: SeriesPoint, m: Metric): number | undefined {
  return m === 'gross' ? p.gross : m === 'commission' ? p.commission : p.completed_rides
}

interface Props {
  series: SeriesPoint[]
  previous: SeriesPoint[] | null
  /** ops_admin never receives money fields; those metric tabs are not offered */
  moneyHidden: boolean
}

/**
 * Trend chart with a metric switch and the previous period as a dashed line. Fewer than three points
 * render as bars with a caption (a lone dot says nothing). Charts tween from previous values (250 ms)
 * and never remount on a filter change; reduced motion disables the animation.
 */
export default function TrendChart({ series, previous, moneyHidden }: Props) {
  const available = METRICS.filter(m => !m.money || !moneyHidden)
  const [metric, setMetric] = useState<Metric>(available[0]!.key)
  const active = available.some(m => m.key === metric) ? metric : available[0]!.key
  const meta = METRICS.find(m => m.key === active)!
  const animate = !prefersReducedMotion()

  const data = useMemo(() => series.map((p, i) => ({
    day: p.day,
    current: valueOf(p, active) ?? 0,
    previous: previous?.[i] ? (valueOf(previous[i]!, active) ?? null) : null,
    previousDay: previous?.[i]?.day ?? null,
  })), [series, previous, active])

  const fmtAxis = (n: number) => (meta.money ? inrCompact(n) : int(n))
  const fmtFull = (n: number) => (meta.money ? inr(n) : int(n))
  const tooltip = dateTooltip(p => {
    const rows: TooltipRow[] = [{ label: meta.label, value: fmtFull(Number(p['current'])), color: COLORS.primary }]
    if (p['previous'] !== null && p['previous'] !== undefined) {
      rows.push({ label: `Previous (${shortDate(String(p['previousDay']))})`, value: fmtFull(Number(p['previous'])), color: COLORS.textMuted, dashed: true })
    }
    return rows
  })

  const lowData = data.length < 3
  const common = { data, margin: { top: 8, right: 8, left: 0, bottom: 0 } }
  const axes = (
    <>
      <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="day" tickFormatter={shortDate} tick={{ fontSize: 12, fill: COLORS.textMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} minTickGap={24} />
      <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 12, fill: COLORS.textMuted }} axisLine={false} tickLine={false} width={56} />
      <Tooltip content={tooltip as never} cursor={{ stroke: COLORS.border }} />
    </>
  )

  return (
    <div>
      <div role="tablist" aria-label="Trend metric" className="flex flex-wrap gap-2 mb-3">
        {available.map(m => (
          <button
            key={m.key} type="button" role="tab" aria-selected={active === m.key}
            onClick={() => setMetric(m.key)}
            className={cn(
              'min-h-[44px] px-4 rounded-full text-base font-semibold transition-colors duration-150 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active === m.key ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="h-[220px]" role="img" aria-label={`${meta.label} by day${previous ? ', with the previous period dashed' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          {lowData ? (
            <BarChart {...common}>
              {axes}
              <Bar dataKey="current" fill={COLORS.primary} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={animate} animationDuration={MOTION.chartMs} animationEasing="ease-out" />
            </BarChart>
          ) : (
            <AreaChart {...common}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              {axes}
              <Area type="linear" dataKey="current" stroke={COLORS.primary} strokeWidth={2} fill="url(#trendFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={animate} animationDuration={MOTION.chartMs} animationEasing="ease-out" />
              {previous && <Line type="linear" dataKey="previous" stroke={COLORS.textMuted} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={animate} animationDuration={MOTION.chartMs} />}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      {lowData && <p className="text-base text-text-secondary mt-2">Only {data.length} day{data.length === 1 ? '' : 's'} in this range, so bars are shown instead of a line.</p>}
    </div>
  )
}
