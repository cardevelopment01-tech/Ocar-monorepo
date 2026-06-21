import { useEffect, useId } from 'react'

import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'

interface SplashScreenProps {
  show: boolean
  onComplete: () => void
}

const TAGLINE = 'Drive smarter. Earn more.'
const WORD = 'ocar'

const EASE_INOUT: [number, number, number, number] = [0.4, 0, 0.2, 1]

const letterContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.7 },
  },
}

const letterChild: Variants = {
  hidden: { y: 16, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 300, damping: 28 },
  },
}

export default function SplashScreen({ show, onComplete }: SplashScreenProps) {
  const reduce = useReducedMotion()
  const gradientId = useId()

  useEffect(() => {
    if (!show) return
    if (reduce) {
      const t = setTimeout(onComplete, 800)
      return () => clearTimeout(t)
    }
    return
  }, [show, reduce, onComplete])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="ocar-splash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ opacity: { duration: 0.35 }, default: { duration: 0.25 } }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: '#0D0B1E',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              width: 280,
              height: 280,
              top: -60,
              right: -40,
              background: 'radial-gradient(circle, rgba(79,70,229,0.45) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 320,
              height: 320,
              bottom: -80,
              left: -60,
              background: 'radial-gradient(circle, rgba(124,58,237,0.35) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', width: 88, height: 88, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {!reduce && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0.4 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ duration: 0.4, delay: 1.1, ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  width: 88,
                  height: 88,
                  borderRadius: '9999px',
                  background: 'radial-gradient(circle, rgba(124,58,237,0.5) 0%, transparent 70%)',
                }}
              />
            )}

            <svg width={88} height={88} viewBox="0 0 100 100" fill="none" role="img" aria-label="Ocar">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#4F46E5" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              <motion.path
                d="M 78.284 78.284 A 40 40 0 1 0 21.716 78.284"
                stroke={`url(#${gradientId})`}
                strokeWidth={9}
                strokeLinecap="round"
                fill="none"
                initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={reduce ? { duration: 0 } : { duration: 0.5, delay: 0.2, ease: EASE_INOUT }}
              />
              <motion.circle
                cx={78.284}
                cy={78.284}
                r={7}
                fill={`url(#${gradientId})`}
                initial={reduce ? { scale: 1 } : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 25, delay: 0.6 }}
                style={{ transformOrigin: '78.284px 78.284px' }}
              />
            </svg>
          </div>

          <motion.div
            variants={reduce ? undefined : letterContainer}
            initial={reduce ? false : 'hidden'}
            animate={reduce ? false : 'visible'}
            style={{
              display: 'flex',
              marginTop: 18,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              fontSize: 34,
              letterSpacing: '-0.03em',
              color: '#FFFFFF',
              lineHeight: 1,
            }}
          >
            {reduce
              ? WORD
              : WORD.split('').map((ch, i) => (
                  <motion.span key={i} variants={letterChild} style={{ display: 'inline-block' }}>
                    {ch}
                  </motion.span>
                ))}
          </motion.div>

          <motion.p
            initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.3, delay: 1.3 }}
            onAnimationComplete={() => {
              if (!reduce) onComplete()
            }}
            style={{
              marginTop: 14,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 400,
              fontSize: 14,
              letterSpacing: '0.01em',
              color: 'rgba(255,255,255,0.55)',
            }}
          >
            {TAGLINE}
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
