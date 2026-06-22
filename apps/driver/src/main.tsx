import React, { useCallback, useLayoutEffect, useState } from 'react'

import { motion } from 'framer-motion'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import SplashScreen from './components/ui/SplashScreen'
import './index.css'

function Root() {
  const [showSplash, setShowSplash] = useState(false)
  const [splashPlayed, setSplashPlayed] = useState(false)

  useLayoutEffect(() => {
    if (!sessionStorage.getItem('ocar_splash_shown')) {
      setShowSplash(true)
      setSplashPlayed(true)
    }
  }, [])

  const handleComplete = useCallback(() => {
    sessionStorage.setItem('ocar_splash_shown', '1')
    setShowSplash(false)
  }, [])

  const inner = (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  )

  return (
    <>
      <SplashScreen show={showSplash} onComplete={handleComplete} />
      <div className="min-h-[100dvh] bg-[#0a0a0a]">
        <div
          className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative overflow-hidden"
          style={{ transform: 'translateZ(0)' }}
        >
          {splashPlayed ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              style={{ minHeight: '100dvh' }}
            >
              {inner}
            </motion.div>
          ) : (
            inner
          )}
        </div>
      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
