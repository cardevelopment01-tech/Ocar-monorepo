'use client'

import { useLayoutEffect, useRef } from 'react'

// Scroll reveal that fails safe: the server renders the content visible, and only
// elements still below the fold at mount are hidden, then revealed by an
// IntersectionObserver. No JS, no observer support or reduced motion = visible.
// The transition itself is CSS (see globals.css), transform/opacity only.
export default function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return

    el.dataset['reveal'] = 'hidden'
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.dataset['reveal'] = 'shown'
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={className} style={delay ? ({ '--d': `${delay}s` } as React.CSSProperties) : undefined}>
      {children}
    </div>
  )
}
