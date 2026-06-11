'use client'
import { useState, useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const GRADIENTS: Record<string, { bg: string; glow: string }> = {
  blue:   {
    bg:   'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
    glow: '0 12px 40px rgba(79,70,229,0.40)',
  },
  green:  {
    bg:   'linear-gradient(135deg, #059669 0%, #0D9488 60%, #0891B2 100%)',
    glow: '0 12px 40px rgba(5,150,105,0.35)',
  },
  amber:  {
    bg:   'linear-gradient(135deg, #F59E0B 0%, #F97316 60%, #EA580C 100%)',
    glow: '0 12px 40px rgba(245,158,11,0.35)',
  },
  purple: {
    bg:   'linear-gradient(135deg, #7C3AED 0%, #A855F7 60%, #EC4899 100%)',
    glow: '0 12px 40px rgba(124,58,237,0.35)',
  },
  pink:   {
    bg:   'linear-gradient(135deg, #E11D48 0%, #F43F5E 60%, #F97316 100%)',
    glow: '0 12px 40px rgba(225,29,72,0.35)',
  },
  cyan:   {
    bg:   'linear-gradient(135deg, #0891B2 0%, #0EA5E9 60%, #38BDF8 100%)',
    glow: '0 12px 40px rgba(8,145,178,0.35)',
  },
}

interface StatCardProps {
  title: string
  value: string | number
  change: string
  changeType: 'up' | 'down' | 'neutral'
  icon: LucideIcon
  gradient: keyof typeof GRADIENTS
}

export default function StatCard({ title, value, change, changeType, icon: Icon, gradient }: StatCardProps) {
  const numericVal = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''))
  const prefix = typeof value === 'string' ? value.replace(/[0-9,. ]+.*/, '') : ''
  const suffix = typeof value === 'string' ? value.replace(/^[^0-9]*[0-9,. ]+/, '') : ''

  const [displayed, setDisplayed] = useState(0)
  const [hovered, setHovered] = useState(false)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (isNaN(numericVal)) return
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
  const g = GRADIENTS[gradient] ?? GRADIENTS.blue

  return (
    <div
      className="stat-card cursor-default"
      style={{
        background: g.bg,
        boxShadow: hovered ? g.glow : '0 4px 16px rgba(15,23,42,0.12)',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        transition: 'box-shadow 250ms ease, transform 250ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Decorative circles */}
      <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
      <div className="absolute -bottom-8 -right-2 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />

      {/* Shimmer stripe */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.10) 50%, transparent 60%)',
        }}
      />

      <div className="relative">
        {/* Top row */}
        <div className="flex items-start justify-between mb-5">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
            <Icon size={20} className="text-white" />
          </div>
          <span className={cn(
            'flex items-center gap-0.5 text-xs font-semibold px-2.5 py-1 rounded-full',
            changeType === 'up'      ? 'bg-white/25 text-white' :
            changeType === 'down'    ? 'bg-black/15 text-red-100' :
            'bg-white/15 text-white/80'
          )}>
            {changeType === 'up'      && <TrendingUp size={11} />}
            {changeType === 'down'    && <TrendingDown size={11} />}
            {changeType === 'neutral' && <Minus size={11} />}
            {change}
          </span>
        </div>

        {/* Value */}
        <p className="text-[32px] font-bold text-white leading-none mb-1.5 tracking-tight">
          {displayVal}
        </p>
        <p className="text-white/70 text-xs font-medium uppercase tracking-wide">{title}</p>
      </div>
    </div>
  )
}
