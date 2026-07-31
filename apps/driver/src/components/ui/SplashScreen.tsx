import { useEffect } from 'react'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import OcarLogoMark from './OcarLogoMark'

interface SplashScreenProps {
  show: boolean
  onComplete: () => void
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const
const APP_BG = '#F5F7FF'

export default function SplashScreen({ show, onComplete }: SplashScreenProps) {
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!show) return
    const t = setTimeout(onComplete, reduce ? 400 : 1200)
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
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* One static ambient glow behind the mark, no pulsing loop */}
          <div
            style={{
              position: 'absolute',
              width: 320,
              height: 320,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 50% 50%, rgba(220,62,147,0.55) 0%, rgba(10,159,176,0.38) 45%, transparent 72%)',
              filter: 'blur(40px)',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            }}
          />

          <motion.div
            initial={reduce ? false : { scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? undefined : { scale: 1.04, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT_EXPO }}
            style={{ position: 'relative' }}
          >
            <OcarLogoMark size="xl" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
