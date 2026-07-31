'use client'
import { useState, useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Restrained tint-chip variants — same 6 semantic colors as before, expressed
// as (light chip bg + saturated icon color) instead of full-bleed gradients,
// mirroring overview's "Secondary stat row" pattern.
const VARIANTS: Record<string, { bg: string; color: string }> = {
  blue:   { bg: '#EEF2FF', color: '#4F46E5' },
  green:  { bg: '#D1FAE5', color: '#10B981' },
  amber:  { bg: '#FEF3C7', color: '#F59E0B' },
  purple: { bg: '#EDE9FE', color: '#8B5CF6' },
  pink:   { bg: '#FEE2E2', color: '#EF4444' },
  cyan:   { bg: '#E0F2FE', color: '#0EA5E9' },
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
      <div className="flex items-start justify-between mb-5">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: v.bg }}
        >
          <Icon size={20} style={{ color: v.color }} />
        </div>
        {loading ? <div className="skeleton h-6 w-16 rounded-full" /> : (
          <span className={cn(
            'flex items-center gap-0.5 text-xs font-semibold px-2.5 py-1 rounded-full',
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
