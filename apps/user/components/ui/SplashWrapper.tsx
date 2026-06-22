'use client'

import { useCallback, useLayoutEffect, useState } from 'react'

import { motion } from 'framer-motion'

import SplashScreen from './SplashScreen'

// useLayoutEffect fires before browser paint; safe on client, skipped on server
const useSplashGate = (callback: () => void) => {
  useLayoutEffect(() => {
    callback()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

export default function SplashWrapper({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(false)
  const [splashPlayed, setSplashPlayed] = useState(false)

  useSplashGate(() => {
    if (!sessionStorage.getItem('ocar_splash_shown')) {
      setShowSplash(true)
      setSplashPlayed(true)
    }
  })

  const handleComplete = useCallback(() => {
    sessionStorage.setItem('ocar_splash_shown', '1')
    setShowSplash(false)
  }, [])

  return (
    <>
      <SplashScreen show={showSplash} onComplete={handleComplete} />
      {splashPlayed ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.div>
      ) : (
        children
      )}
    </>
  )
}
