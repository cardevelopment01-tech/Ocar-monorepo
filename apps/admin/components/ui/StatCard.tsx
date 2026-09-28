'use client'
import { useState, useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COLORS } from '@/lib/colors'

// Restrained tint-chip variants — same 6 semantic colors as before, expressed
// as (light chip bg + saturated icon color) instead of full-bleed gradients,
// mirroring overview's "Secondary stat row" pattern.
const VARIANTS: Record<string, { bg: string; color: string }> = {
  blue:   { bg: COLORS.primaryLight, color: COLORS.primary },
  green:  { bg: COLORS.successLight, color: COLORS.success },
  amber:  { bg: COLORS.warningLight, color: COLORS.warning },
  purple: { bg: COLORS.purpleLight,  color: COLORS.purple },
  pink:   { bg: COLORS.dangerLight,  color: COLORS.danger },
  cyan:   { bg: COLORS.infoLight,    color: COLORS.info },
}

interface StatCardProps {
  title: string
  value: string | number
  change: string
  changeType: 'up' | 'down' | 'neutral'
  icon: LucideIcon
  gradient: keyof typeof VARIANTS
  loading?: boolean
}

export default function StatCard({ title, value, change, changeType, icon: Icon, gradient, loading = false }: StatCardProps) {
  const numericVal = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''))
  const prefix = typeof value === 'string' ? value.replace(/[0-9,. ]+.*/, '') : ''
  const suffix = typeof value === 'string' ? value.replace(/^[^0-9]*[0-9,. ]+/, '') : ''

  const [displayed, setDisplayed] = useState(0)
  const animatedOnce = useRef(false)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (isNaN(numericVal)) return
    // Count-up runs once, the first time real data arrives. Later poll
    // refreshes snap straight to the new value instead of re-animating.
    if (animatedOnce.current) {
      setDisplayed(numericVal)
      return
    }
    animatedOnce.current = true
    const start = Date.now()
    const duration = 800
    const animate = () => {
      const t = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayed(Math.round(eased * numericVal))
      if (t < 1) raf.current = requestAnimationFrame(animate)
    }
    raf.current = requestAnimationFrame(animate)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [numericVal])

  const displayVal = isNaN(numericVal) ? value : `${prefix}${displayed.toLocaleString('en-IN')}${suffix}`
  const v = VARIANTS[gradient] ?? VARIANTS.blue

  return (
    <div className="admin-card cursor-default">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-5">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: v.bg }}
        >
          <Icon size={20} style={{ color: v.color }} />
        </div>
        {loading ? <div className="skeleton h-6 w-16 rounded-full" /> : (
          <span className={cn(
            'flex items-center gap-0.5 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap',
            changeType === 'up'   ? 'bg-success-light text-success' :
            changeType === 'down' ? 'bg-danger-light text-danger' :
            'bg-surface-2 text-text-muted'
          )}>
            {changeType === 'up'      && <TrendingUp size={11} />}
            {changeType === 'down'    && <TrendingDown size={11} />}
            {changeType === 'neutral' && <Minus size={11} />}
            {change}
          </span>
        )}
      </div>

      {loading
        ? <div className="skeleton h-8 w-16 rounded mb-1.5" />
        : (
          <p className="text-[32px] font-bold text-text-primary leading-none mb-1.5 tracking-tight">
            {displayVal}
          </p>
        )}
      <p className="text-text-muted text-xs font-medium">{title}</p>
    </div>
  )
}

// ── Band variant (Reports KPI band, design D2/D5) ─────────────────────────────
// One connected card holds several of these cells, separated by hairline dividers, so the row reads
// as one instrument panel instead of a mosaic of equal cards. No icon chip, no own shadow or radius.
// Deltas always carry an arrow and text (colour is never the only signal).

export interface BandDelta {
  text: string
  direction: 'up' | 'down' | 'flat'
  /** good/bad decides the colour; direction decides the arrow */
  tone: 'good' | 'bad' | 'neutral'
}

interface StatBandProps {
  title: string
  /** shown as-is when `rawValue` is absent */
  value: string
  /** numeric value: when it changes the displayed number tweens (250 ms) instead of snapping */
  rawValue?: number
  format?: (n: number) => string
  delta?: BandDelta | null
  /** hint under the delta, e.g. "of requests" or "no comparison data" */
  hint?: string
  sparkline?: number[]
  loading?: boolean
  onClick?: () => void
  ariaLabel?: string
}

function useTween(target: number | undefined, ms: number): number | undefined {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (target === undefined) { setShown(undefined); return }
    const start = from.current
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (start === undefined || start === target || reduce || ms <= 0) { from.current = target; setShown(target); return }
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - t0) / ms, 1)
      setShown(start + (target - start) * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); from.current = target }
  }, [target, ms])
  return shown
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 3) return <div className="h-7" aria-hidden />
  const w = 120, h = 28, pad = 2
  const min = Math.min(...points), max = Math.max(...points)
  const span = max - min || 1
  const xy = points.map((p, i) => [pad + (i * (w - pad * 2)) / (points.length - 1), h - pad - ((p - min) / span) * (h - pad * 2)] as const)
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block" role="img" aria-label={`Trend over ${points.length} days`}>
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={COLORS.primary} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function StatBand({ title, value, rawValue, format, delta, hint, sparkline, loading = false, onClick, ariaLabel }: StatBandProps) {
  const tweened = useTween(rawValue, 250)
  const text = rawValue !== undefined && format && tweened !== undefined ? format(tweened) : value
  const Wrapper = onClick ? 'button' : 'div'
  const Arrow = delta?.direction === 'up' ? TrendingUp : delta?.direction === 'down' ? TrendingDown : Minus
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick, 'aria-label': ariaLabel ?? `${title}: ${value}. Open details` } : {})}
      className={cn(
        'flex-1 min-w-[150px] px-5 py-4 text-left flex flex-col items-stretch justify-start transition-colors duration-150 motion-reduce:transition-none',
        onClick && 'hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset'
      )}
    >
      <p className="text-base font-medium text-text-secondary">{title}</p>
      {loading ? <div className="skeleton h-8 w-24 rounded mt-2" /> : (
        <p className="font-display text-[28px] leading-9 font-bold text-text-primary tabular-nums tracking-tight mt-1">{text}</p>
      )}
      <div className="mt-1 min-h-[22px] flex items-center gap-2 flex-wrap">
        {delta ? (
          <span className={cn('inline-flex items-center gap-1 text-sm font-semibold',
            delta.tone === 'good' ? 'text-success' : delta.tone === 'bad' ? 'text-danger' : 'text-text-secondary')}>
            <Arrow size={12} aria-hidden />{delta.text}
          </span>
        ) : null}
        {hint && <span className="text-sm text-text-muted">{hint}</span>}
      </div>
      <div className="mt-auto pt-2"><Sparkline points={sparkline ?? []} /></div>
    </Wrapper>
  )
}
