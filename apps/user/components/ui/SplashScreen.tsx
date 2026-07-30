'use client'

import { useEffect, useId } from 'react'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

interface SplashScreenProps {
  show: boolean
  onComplete: () => void
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const
const APP_BG = '#F5F7FF'

export default function SplashScreen({ show, onComplete }: SplashScreenProps) {
  const reduce = useReducedMotion()
  const gradientId = useId()
  const dotGradientId = `${gradientId}-dot`

  useEffect(() => {
    if (!show) return
    const t = setTimeout(onComplete, reduce ? 400 : 1600)
    return () => clearTimeout(t)
  }, [show]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="ocar-splash"
          initial={{ opacity: 1, backgroundColor: '#0F0D1A' }}
          exit={
            reduce
              ? { opacity: 0 }
              : { opacity: 0, backgroundColor: APP_BG }
          }
          transition={{ duration: reduce ? 0.2 : 0.45, ease: EASE_OUT_EXPO }}
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
          {/* Glow bloom, tracks arc completion, settles. Single premium technique. */}
          <motion.div
            initial={reduce ? false : { opacity: 0.15, scale: 0.9 }}
            animate={
              reduce
                ? { opacity: 0.4, scale: 1 }
                : { opacity: [0.15, 0.55, 0.4], scale: [0.9, 1.05, 1] }
            }
            transition={reduce ? { duration: 0 } : { duration: 0.85, delay: 0.1, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              width: 320,
              height: 320,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 50% 50%, rgba(220, 62, 147,0.45) 0%, rgba(10, 159, 176,0.28) 35%, transparent 70%)',
              filter: 'blur(12px)',
              pointerEvents: 'none',
            }}
          />

          {/* Logo group, subtle scale entrance; pushes through on exit */}
          <motion.div
            initial={reduce ? false : { scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? undefined : { scale: 1.04, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT_EXPO }}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <svg
              width={72}
              height={72}
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
                  <stop offset="0%" stopColor="#0A9FB0" />
                  <stop offset="100%" stopColor="#DC3E93" />
                </linearGradient>
                <linearGradient
                  id={dotGradientId}
                  x1="0"
                  y1="0"
                  x2="100"
                  y2="100"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#0A9FB0" />
                  <stop offset="100%" stopColor="#DC3E93" />
                </linearGradient>
              </defs>

              {/* Arc draws on, signature motion */}
              <motion.path
                d="M 78.284 78.284 A 40 40 0 1 0 21.716 78.284"
                stroke={`url(#${gradientId})`}
                strokeWidth={7.5}
                strokeLinecap="round"
                fill="none"
                initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { duration: 0.75, delay: 0.1, ease: 'easeInOut' }
                }
              />

              {/* Dot snaps in as the arc resolves */}
              <motion.circle
                cx={78.284}
                cy={78.284}
                r={8}
                fill={`url(#${dotGradientId})`}
                initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { duration: 0.28, delay: 0.7, ease: EASE_OUT_EXPO }
                }
                style={{ transformOrigin: '78.284px 78.284px' }}
              />
            </svg>

            {/* Wordmark resolves with the dot, upward settle, not an arbitrary fade */}
            <motion.span
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { duration: 0.4, delay: 0.7, ease: EASE_OUT_EXPO }
              }
              style={{
                fontFamily: 'Inter, sans-serif',
                fontWeight: 700,
                fontSize: 28,
                letterSpacing: '-0.03em',
                color: '#FFFFFF',
                lineHeight: 1,
              }}
            >
              ocar
            </motion.span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
