'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface RideStatusBarProps {
  progress?: number
  animate?: boolean
  className?: string
}

export default function RideStatusBar({
  progress,
  animate = true,
  className,
}: RideStatusBarProps) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (progress !== undefined) {
      setWidth(progress)
      return
    }
    if (animate) {
      const timer = setTimeout(() => setWidth(65), 300)
      return () => clearTimeout(timer)
    }
  }, [progress, animate])

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-between text-xs text-text-muted mb-2">
        <span>Pickup</span>
        <span>En route</span>
        <span>Destination</span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}
