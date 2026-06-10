'use client'

import { useEffect, useRef, useState } from 'react'

interface AnimatedNumberProps {
  value: number
  /** ms */
  duration?: number
  format?: (n: number) => string
}

/**
 * Counts up (or down) to `value` with an ease-out curve. Used for fares so the
 * price feels alive when it lands instead of snapping in.
 */
export default function AnimatedNumber({
  value,
  duration = 550,
  format = (n) => Math.round(n).toString(),
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    const delta = value - from
    if (delta === 0) return

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setDisplay(from + delta * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      fromRef.current = value
    }
  }, [value, duration])

  return <span className="tabular-nums">{format(display)}</span>
}
