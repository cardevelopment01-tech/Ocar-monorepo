import { useEffect, useId } from 'react'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

interface SplashScreenProps {
  show: boolean
  onComplete: () => void
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

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
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeInOut' }}
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
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse 55% 45% at 50% 50%, rgba(79,70,229,0.22) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />

          <motion.div
            initial={reduce ? false : { scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={
              reduce
                ? { duration: 0 }
                : { duration: 0.5, ease: EASE_OUT_EXPO }
            }
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}
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
                  <stop offset="0%" stopColor="#4F46E5" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
                <linearGradient
                  id={dotGradientId}
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
                    : { duration: 0.7, ease: 'easeInOut' }
                }
              />

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
                    : { duration: 0.25, delay: 0.55, ease: 'easeOut' }
                }
                style={{ transformOrigin: '78.284px 78.284px' }}
              />
            </svg>

            <motion.span
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.3, delay: 0.5 }}
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
