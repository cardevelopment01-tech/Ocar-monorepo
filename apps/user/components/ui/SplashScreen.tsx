'use client'

import { useEffect, useId } from 'react'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

interface SplashScreenProps {
  show: boolean
  onComplete: () => void
}

export default function SplashScreen({ show, onComplete }: SplashScreenProps) {
  const reduce = useReducedMotion()
  const gradientId = useId()

  useEffect(() => {
    if (!show) return
    const t = setTimeout(onComplete, reduce ? 400 : 1200)
    return () => clearTimeout(t)
  }, [show, reduce, onComplete])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="ocar-splash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: '#0F0D1A',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Subtle static ambient — no animation */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(79,70,229,0.15) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Logo — single clean fade, nothing else */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
          >
            <svg
              width={64}
              height={64}
              viewBox="0 0 100 100"
              fill="none"
              role="img"
              aria-label="Ocar"
            >
              <defs>
                <linearGradient
                  id={gradientId}
                  x1="0"
                  y1="0"
                  x2="100"
                  y2="100"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#4F46E5" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              <path
                d="M 78.284 78.284 A 40 40 0 1 0 21.716 78.284"
                stroke={`url(#${gradientId})`}
                strokeWidth={9}
                strokeLinecap="round"
                fill="none"
              />
              <circle cx={78.284} cy={78.284} r={7} fill={`url(#${gradientId})`} />
            </svg>

            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: 26,
                letterSpacing: '-0.03em',
                color: '#FFFFFF',
                lineHeight: 1,
              }}
            >
              ocar
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
