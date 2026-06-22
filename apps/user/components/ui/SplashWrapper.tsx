'use client'

import { useCallback, useLayoutEffect, useState } from 'react'

import SplashScreen from './SplashScreen'

// useLayoutEffect fires before browser paint; safe on client, skipped on server
const useSplashGate = (callback: () => void) => {
  useLayoutEffect(() => {
    callback()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

export default function SplashWrapper({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(false)

  useSplashGate(() => {
    if (!sessionStorage.getItem('ocar_splash_shown')) {
      setShowSplash(true)
    }
  })

  const handleComplete = useCallback(() => {
    sessionStorage.setItem('ocar_splash_shown', '1')
    setShowSplash(false)
  }, [])

  return (
    <>
      <SplashScreen show={showSplash} onComplete={handleComplete} />
      {children}
    </>
  )
}
