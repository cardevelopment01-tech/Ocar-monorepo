'use client'

import { useEffect, useState } from 'react'

import SplashScreen from './SplashScreen'

export default function SplashWrapper({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(false)

  useEffect(() => {
    if (!sessionStorage.getItem('ocar_splash_shown')) {
      setShowSplash(true)
    }
  }, [])

  function handleComplete() {
    sessionStorage.setItem('ocar_splash_shown', '1')
    setShowSplash(false)
  }

  return (
    <>
      <SplashScreen show={showSplash} onComplete={handleComplete} />
      {children}
    </>
  )
}
