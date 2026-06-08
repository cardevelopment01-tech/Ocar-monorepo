import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface StatusBarProps {
  isOnline: boolean
  earningsToday: number
}

export default function StatusBar({ isOnline, earningsToday }: StatusBarProps) {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))

  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4"
      style={{ height: 44, background: 'rgba(10,12,16,0.85)', backdropFilter: 'blur(8px)' }}
    >
      {/* Online/offline */}
      <div className="flex items-center gap-1.5">
        <span className={cn(
          'w-2 h-2 rounded-full',
          isOnline ? 'bg-primary animate-pulse-soft' : 'bg-text-muted'
        )} />
        <span className={cn('text-xs font-bold tracking-wider', isOnline ? 'text-primary' : 'text-text-muted')}>
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* Clock */}
      <span className="text-sm font-semibold text-text-primary tabular-nums">{time}</span>

      {/* Earnings */}
      <span className="text-sm font-bold text-primary">₹{earningsToday.toLocaleString('en-IN')}</span>
    </div>
  )
}
