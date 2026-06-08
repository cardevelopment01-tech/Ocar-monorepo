'use client'
import { useState, useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const GRADIENTS: Record<string, string> = {
  blue:   'from-blue-500 to-blue-700',
  green:  'from-emerald-500 to-teal-600',
  amber:  'from-amber-400 to-orange-500',
  purple: 'from-violet-500 to-purple-700',
  pink:   'from-rose-400 to-pink-600',
  cyan:   'from-cyan-400 to-sky-600',
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

  return (
    <div className={cn(
      'stat-card bg-gradient-to-br cursor-default',
      'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-hover',
      GRADIENTS[gradient]
    )}>
      {/* Decorative circle */}
      <div className="absolute -top-4 -right-4 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />

      <div className="relative flex items-start justify-between mb-4">
        <Icon size={22} className="text-white/80" />
        <span className={cn(
          'flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20',
          changeType === 'up' ? 'text-white' : changeType === 'down' ? 'text-red-100' : 'text-white/70'
        )}>
          {changeType === 'up' && <TrendingUp size={11} />}
          {changeType === 'down' && <TrendingDown size={11} />}
          {changeType === 'neutral' && <Minus size={11} />}
          {change}
        </span>
      </div>

      <p className="text-[28px] font-bold text-white leading-none mb-1">{displayVal}</p>
      <p className="text-white/70 text-xs font-medium">{title}</p>
    </div>
  )
}
