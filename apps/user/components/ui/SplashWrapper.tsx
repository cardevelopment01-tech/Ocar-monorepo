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
  // Start true so SSR HTML already has the splash covering the page.
  // useLayoutEffect (client-only, fires before first paint) flips it off
  // immediately if the splash was already shown this session.
  const [showSplash, setShowSplash] = useState(true)

  useSplashGate(() => {
    if (sessionStorage.getItem('ocar_splash_shown')) {
      setShowSplash(false)
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
