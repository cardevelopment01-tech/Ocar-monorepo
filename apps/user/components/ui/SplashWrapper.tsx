'use client'

import { useState } from 'react'

import SplashScreen from './SplashScreen'

export default function SplashWrapper({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(true)

  return (
    <>
      <SplashScreen show={showSplash} onComplete={() => setShowSplash(false)} />
      {children}
    </>
  )
}
