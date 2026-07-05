import React, { useCallback, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { APIProvider } from '@vis.gl/react-google-maps'
import { motion } from 'framer-motion'
import App from './App'
import SplashScreen from './components/ui/SplashScreen'
import './index.css'

function Root() {
  // Compute synchronously on first render — avoids useLayoutEffect flash
  const willSplash = !sessionStorage.getItem('ocar_splash_shown')

  const [showSplash, setShowSplash] = useState(willSplash)
  const [appVisible, setAppVisible] = useState(!willSplash)

  const handleComplete = useCallback(() => {
    sessionStorage.setItem('ocar_splash_shown', '1')
    setShowSplash(false)
    setAppVisible(true)
  }, [])

  return (
    <>
      <SplashScreen show={showSplash} onComplete={handleComplete} />
      <div className="min-h-[100dvh] bg-[#0a0a0a]">
        <motion.div
          className="mx-auto max-w-[430px] min-h-[100dvh] bg-background relative overflow-x-hidden"
          initial={false}
          animate={{ opacity: appVisible ? 1 : 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </motion.div>
      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_KEY} libraries={['places']}>
      <Root />
    </APIProvider>
  </React.StrictMode>
)
